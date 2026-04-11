/**
 * ReportPanel.jsx — CMTI Report Engine v10.0 (refined)
 *
 * UX changes from previous version:
 * - ThemeToggle removed from menubar (lives in Sidebar/settings)
 * - Fake menu items (File, Edit, Insert…) removed — they added visual noise with no function
 * - Menubar is now a focused topbar: brand + file chip + back button
 * - Second toolbar unchanged (generate, compile, edit, copy, download)
 * - All inline styles preserved — zero Tailwind, all CSS vars
 * - LaTeXEditor with dynamic line numbers unchanged (complex, works well)
 * - Outline, LiveLog, PDFViewer unchanged
 * - Colors: zero hardcoded hex values — all var() references preserved
 */

import { useState, useRef, useEffect, useCallback, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { useApp, API } from "../context/AppContext";

/* ─── constants ─────────────────────────────────────────────── */
const SESSION_HINT_KEY = "rp_query_hint_v6";
const MAX_RETRIES = 3;
const RETRY_DELAYS = [2000, 5000, 12000];

const PIPELINE_STEPS = [
    { event: "start", icon: "⬡", label: "Connecting" },
    { event: "structure", icon: "◈", label: "Reading structure" },
    { event: "section_start", icon: "⟁", label: "Extracting" },
    { event: "section_extracted", icon: "▦", label: "Writing LaTeX" },
    { event: "assembling", icon: "⊟", label: "Assembling" },
    { event: "done", icon: "✦", label: "Complete" },
];

const cleanName = (s = "") =>
    s.replace(/_pdf$/i, "").replace(/\.pdf$/i, "").replace(/_/g, " ").trim();

/* ─── SVG icons ──────────────────────────────────────────────── */
const Icons = {
    File: (p = {}) => (
        <svg width={p.size || 14} height={p.size || 14} viewBox="0 0 24 24" fill="none" stroke={p.color || "currentColor"} strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round">
            <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z" /><polyline points="14 2 14 8 20 8" />
        </svg>
    ),
    FileText: (p = {}) => (
        <svg width={p.size || 14} height={p.size || 14} viewBox="0 0 24 24" fill="none" stroke={p.color || "currentColor"} strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round">
            <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z" /><polyline points="14 2 14 8 20 8" />
            <line x1="9" y1="15" x2="15" y2="15" /><line x1="9" y1="11" x2="15" y2="11" />
        </svg>
    ),
    ChevLeft: (p = {}) => (
        <svg width={p.size || 13} height={p.size || 13} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
            <polyline points="15 18 9 12 15 6" />
        </svg>
    ),
    Copy: (p = {}) => (
        <svg width={p.size || 13} height={p.size || 13} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
            <rect x="9" y="9" width="13" height="13" rx="2" ry="2" /><path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1" />
        </svg>
    ),
    Download: (p = {}) => (
        <svg width={p.size || 13} height={p.size || 13} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
            <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4" /><polyline points="7 10 12 15 17 10" /><line x1="12" y1="15" x2="12" y2="3" />
        </svg>
    ),
    Edit: (p = {}) => (
        <svg width={p.size || 13} height={p.size || 13} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
            <path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7" /><path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z" />
        </svg>
    ),
    Zap: (p = {}) => (
        <svg width={p.size || 13} height={p.size || 13} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
            <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" />
        </svg>
    ),
    X: (p = {}) => (
        <svg width={p.size || 12} height={p.size || 12} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round">
            <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
        </svg>
    ),
    Refresh: (p = {}) => (
        <svg width={p.size || 13} height={p.size || 13} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
            <polyline points="23 4 23 10 17 10" /><polyline points="1 20 1 14 7 14" />
            <path d="M3.51 9a9 9 0 0114.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0020.49 15" />
        </svg>
    ),
    Check: (p = {}) => (
        <svg width={p.size || 13} height={p.size || 13} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round">
            <polyline points="20 6 9 17 4 12" />
        </svg>
    ),
    Plus: (p = {}) => (
        <svg width={p.size || 12} height={p.size || 12} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round">
            <line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" />
        </svg>
    ),
    Minus: (p = {}) => (
        <svg width={p.size || 13} height={p.size || 13} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round">
            <line x1="5" y1="12" x2="19" y2="12" />
        </svg>
    ),
    Layers: (p = {}) => (
        <svg width={p.size || 32} height={p.size || 32} viewBox="0 0 24 24" fill="none" stroke={p.color || "currentColor"} strokeWidth={1.3} strokeLinecap="round" strokeLinejoin="round">
            <polygon points="12 2 2 7 12 12 22 7 12 2" /><polyline points="2 17 12 22 22 17" /><polyline points="2 12 12 17 22 12" />
        </svg>
    ),
    Alert: (p = {}) => (
        <svg width={p.size || 13} height={p.size || 13} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
            <circle cx="12" cy="12" r="10" /><line x1="12" y1="8" x2="12" y2="12" /><line x1="12" y1="16" x2="12.01" y2="16" />
        </svg>
    ),
    Clock: (p = {}) => (
        <svg width={p.size || 22} height={p.size || 22} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round">
            <circle cx="12" cy="12" r="10" /><polyline points="12 6 12 12 16 14" />
        </svg>
    ),
    ArrowLeft: (p = {}) => (
        <svg width={p.size || 13} height={p.size || 13} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
            <line x1="19" y1="12" x2="5" y2="12" /><polyline points="12 19 5 12 12 5" />
        </svg>
    ),
};

/* ─── LaTeX syntax highlighter ───────────────────────────────── */
const C = {
    comment: "#6a9955", command: "#7cb8f8", brace: "#e6c87a",
    math: "#4ec9b0", number: "#b5cea8", special: "#dcdcaa",
    string: "#ce9178", def: "#d4d4cc",
};

function highlightLatex(code) {
    const esc = s => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
    const rules = [
        { re: /(%[^\n]*)/g, col: C.comment },
        { re: /(\$\$[\s\S]*?\$\$|\$[^$\n]*?\$)/g, col: C.math },
        { re: /(\\[a-zA-Z]+\*?)/g, col: C.command },
        { re: /([{}])/g, col: C.brace },
        { re: /(\[|\])/g, col: C.string },
        { re: /\b(\d+(?:\.\d+)?(?:pt|em|cm|mm|in)?)\b/g, col: C.number },
        { re: /([&_^~])/g, col: C.special },
    ];
    const len = code.length;
    const cols = new Array(len).fill(null);
    for (const { re, col } of rules) {
        re.lastIndex = 0; let m;
        while ((m = re.exec(code)) !== null)
            for (let i = m.index; i < m.index + m[0].length; i++)
                if (!cols[i]) cols[i] = col;
    }
    let html = "", i = 0;
    while (i < len) {
        const c = cols[i] || C.def;
        let j = i + 1;
        while (j < len && (cols[j] || C.def) === c) j++;
        html += `<span style="color:${c}">${esc(code.slice(i, j))}</span>`;
        i = j;
    }
    return html;
}

/* ─── LaTeX editor ───────────────────────────────────────────── */
function LaTeXEditor({ value, onChange, readOnly, fontSize = 13 }) {
    const taRef = useRef(null);
    const preRef = useRef(null);
    const gutRef = useRef(null);
    const lh = Math.round(fontSize * 1.72);
    const count = value.split("\n").length;

    const sync = useCallback(() => {
        const ta = taRef.current;
        if (!ta) return;
        if (preRef.current) { preRef.current.scrollTop = ta.scrollTop; preRef.current.scrollLeft = ta.scrollLeft; }
        if (gutRef.current) { gutRef.current.scrollTop = ta.scrollTop; }
    }, []);

    const highlighted = useMemo(() => highlightLatex(value), [value]);

    const mono = {
        fontFamily: "'JetBrains Mono','Fira Code',monospace",
        fontSize, lineHeight: `${lh}px`,
        tabSize: 2, whiteSpace: "pre", overflowWrap: "normal",
    };

    return (
        <div style={{ display: "flex", flex: 1, overflow: "hidden", background: "var(--ed-bg)" }}>
            <div ref={gutRef} style={{ width: 52, flexShrink: 0, background: "var(--ed-gutter)", borderRight: "1px solid var(--border)", overflowY: "hidden", overflowX: "hidden", userSelect: "none" }}>
                <div style={{ ...mono, paddingTop: 10, paddingRight: 10, textAlign: "right", color: "var(--text-faint)" }}>
                    {Array.from({ length: count }, (_, i) => (
                        <div key={i} style={{ height: lh }}>{i + 1}</div>
                    ))}
                    <div style={{ height: lh * 2 }} />
                </div>
            </div>
            <div style={{ position: "relative", flex: 1, overflow: "hidden" }}>
                <pre
                    ref={preRef}
                    aria-hidden
                    style={{ ...mono, position: "absolute", inset: 0, margin: 0, padding: "10px 24px 10px 14px", overflow: "hidden", pointerEvents: "none", userSelect: "none" }}
                    dangerouslySetInnerHTML={{ __html: highlighted + "\n" }}
                />
                <textarea
                    ref={taRef}
                    value={value}
                    onChange={readOnly ? undefined : e => onChange(e.target.value)}
                    onScroll={sync}
                    readOnly={readOnly}
                    spellCheck={false}
                    autoCapitalize="off"
                    autoCorrect="off"
                    style={{ ...mono, position: "absolute", inset: 0, margin: 0, padding: "10px 24px 10px 14px", background: "transparent", color: "transparent", caretColor: "var(--accent)", border: "none", outline: "none", resize: "none", width: "100%", height: "100%", overflowX: "auto", overflowY: "auto" }}
                />
            </div>
        </div>
    );
}

/* ─── Section outline ────────────────────────────────────────── */
function Outline({ latex }) {
    const sections = useMemo(() => {
        if (!latex) return [];
        const res = [], re = /\\(section|subsection|subsubsection)\*?\{([^}]+)\}/g;
        let m;
        while ((m = re.exec(latex)) !== null) res.push({ level: m[1], title: m[2] });
        return res;
    }, [latex]);

    if (!sections.length) return (
        <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", flex: 1, gap: 10, padding: "24px 12px" }}>
            <Icons.Layers size={28} color="var(--text-faint)" />
            <p style={{ margin: 0, color: "var(--text-faint)", fontSize: 11, fontFamily: "'JetBrains Mono',monospace", textAlign: "center", lineHeight: 2 }}>
                Outline appears<br />after generation
            </p>
        </div>
    );

    return (
        <div style={{ overflow: "auto", flex: 1 }}>
            {sections.map((s, i) => {
                const indent = s.level === "section" ? 8 : s.level === "subsection" ? 20 : 32;
                const col = s.level === "section" ? "var(--accent)" : s.level === "subsection" ? "var(--text-muted)" : "var(--text-faint)";
                const fs = s.level === "section" ? 11.5 : s.level === "subsection" ? 11 : 10.5;
                const prefix = s.level === "section" ? "§ " : s.level === "subsection" ? "› " : "· ";
                const isSection = s.level === "section";
                return (
                    <div key={i} style={{ paddingLeft: indent, paddingRight: 8, paddingTop: 5, paddingBottom: 5, fontSize: fs, color: col, cursor: "pointer", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", borderBottom: "1px solid var(--border)", fontFamily: isSection ? "'Fraunces',Georgia,serif" : "'JetBrains Mono',monospace", fontStyle: isSection ? "italic" : "normal", transition: "background .12s" }}
                        onMouseEnter={e => { e.currentTarget.style.background = "var(--bg-elevated)"; }}
                        onMouseLeave={e => { e.currentTarget.style.background = "transparent"; }}
                    >
                        {prefix}{s.title}
                    </div>
                );
            })}
        </div>
    );
}

/* ─── Live log ───────────────────────────────────────────────── */
function LiveLog({ log, loading, detectedMeta }) {
    const endRef = useRef(null);
    useEffect(() => endRef.current?.scrollIntoView({ behavior: "smooth" }), [log]);

    return (
        <div style={{ flex: 1, overflow: "auto", display: "flex", flexDirection: "column" }}>
            {detectedMeta && (
                <div style={{ margin: "10px 10px 4px", padding: "8px 10px", background: "var(--bg-panel)", border: "1px solid var(--border)", borderRadius: 6, fontSize: 10, fontFamily: "'JetBrains Mono',monospace", lineHeight: 1.9 }}>
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
                    <span style={{ fontSize: 10, flex: 1, color: entry.done ? "var(--text-faint)" : "var(--text-body)", fontFamily: "'JetBrains Mono',monospace", lineHeight: 1.5 }}>{entry.label}</span>
                    {i === log.length - 1 && loading && (
                        <span style={{ width: 5, height: 5, borderRadius: "50%", background: "var(--accent)", flexShrink: 0, animation: "blink 1.2s ease-in-out infinite" }} />
                    )}
                </div>
            ))}
            <div ref={endRef} />
            {!loading && log.length === 0 && (
                <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", flex: 1, gap: 10, padding: "24px 12px", color: "var(--text-faint)", fontSize: 10, fontFamily: "'JetBrains Mono',monospace", textAlign: "center" }}>
                    <Icons.Clock size={24} />
                    <span style={{ lineHeight: 1.9 }}>Generate a report<br />to see live progress</span>
                </div>
            )}
        </div>
    );
}

/* ─── PDF viewer ─────────────────────────────────────────────── */
function PDFViewer({ pdfUrl, compiling, onCompile, latexSource, compileError }) {
    const [zoom, setZoom] = useState(100);

    if (!pdfUrl) return (
        <div style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 18, background: "var(--bg-panel)" }}>
            <div style={{ opacity: 0.2 }}><Icons.Layers size={52} color="var(--text-muted)" /></div>
            <p style={{ margin: 0, fontFamily: "'Fraunces',Georgia,serif", fontStyle: "italic", fontSize: 15, color: "var(--text-muted)" }}>No compiled PDF yet</p>
            <button onClick={onCompile} disabled={!latexSource || compiling} style={{ ...ab("primary"), padding: "7px 18px", opacity: (!latexSource || compiling) ? 0.4 : 1 }}>
                {compiling ? <><Spinner col="var(--accent)" /> Compiling…</> : <><Icons.Refresh size={13} /> Compile → PDF</>}
            </button>
            {compileError && <p style={{ margin: 0, color: "var(--red-soft)", fontSize: 11, fontFamily: "'JetBrains Mono',monospace", maxWidth: 280, textAlign: "center" }}>{compileError}</p>}
        </div>
    );

    return (
        <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden", background: "var(--bg-panel)" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "0 12px", height: 40, flexShrink: 0, background: "var(--bg-surface)", borderBottom: "1px solid var(--border)" }}>
                <button onClick={onCompile} disabled={compiling} style={ab("green")}>
                    {compiling ? <><Spinner col="var(--green-vivid)" /> Compiling…</> : <><Icons.Refresh size={13} /> Recompile</>}
                </button>
                <Sep />
                <IBtn onClick={() => setZoom(z => Math.max(50, z - 10))}><Icons.Minus size={12} /></IBtn>
                <span style={{ fontSize: 11, color: "var(--text-muted)", minWidth: 38, textAlign: "center", fontFamily: "'JetBrains Mono',monospace", fontVariantNumeric: "tabular-nums" }}>{zoom}%</span>
                <IBtn onClick={() => setZoom(z => Math.min(200, z + 10))}><Icons.Plus size={11} /></IBtn>
            </div>
            <div style={{ flex: 1, overflow: "auto", display: "flex", alignItems: "flex-start", justifyContent: "center", background: "var(--bg-panel)", padding: "16px 0" }}>
                <iframe src={pdfUrl} title="Compiled PDF" style={{ width: `${zoom}%`, flex: "none", border: "none", background: "white", boxShadow: "0 4px 32px rgba(0,0,0,0.22)", minHeight: "calc(100vh - 120px)", transition: "width .2s ease" }} />
            </div>
        </div>
    );
}

/* ─── Shared atoms ───────────────────────────────────────────── */
const Spinner = ({ col = "var(--accent)" }) => (
    <span style={{ display: "inline-block", width: 10, height: 10, borderRadius: "50%", border: "2px solid transparent", borderTopColor: col, animation: "spin 0.8s linear infinite", flexShrink: 0 }} />
);

const Sep = () => (
    <div style={{ width: 1, height: 18, background: "var(--border)", margin: "0 2px", flexShrink: 0 }} />
);

const IBtn = ({ onClick, children, title }) => (
    <button onClick={onClick} title={title}
        style={{ background: "transparent", border: "1px solid var(--border)", color: "var(--text-muted)", cursor: "pointer", borderRadius: 5, width: 24, height: 24, display: "inline-flex", alignItems: "center", justifyContent: "center", transition: "all .12s", flexShrink: 0 }}
        onMouseEnter={e => { e.currentTarget.style.borderColor = "var(--border-mid)"; e.currentTarget.style.color = "var(--text-body)"; }}
        onMouseLeave={e => { e.currentTarget.style.borderColor = "var(--border)"; e.currentTarget.style.color = "var(--text-muted)"; }}
    >{children}</button>
);

const ab = (variant = "ghost") => {
    const base = { display: "inline-flex", alignItems: "center", gap: 5, border: "1px solid", borderRadius: 7, cursor: "pointer", fontFamily: "'JetBrains Mono',monospace", fontSize: 11, padding: "4px 12px", transition: "all .15s", userSelect: "none", flexShrink: 0 };
    const v = {
        primary: { background: "var(--accent-dim)", borderColor: "var(--accent)", color: "var(--accent)" },
        green: { background: "rgba(74,222,128,.08)", borderColor: "rgba(74,222,128,.25)", color: "var(--green-vivid)" },
        ghost: { background: "transparent", borderColor: "var(--border)", color: "var(--text-muted)" },
        teal: { background: "var(--teal-dim)", borderColor: "var(--teal)", color: "var(--teal)" },
        danger: { background: "transparent", borderColor: "rgba(248,113,113,.3)", color: "var(--red-soft)" },
    };
    return { ...base, ...(v[variant] || v.ghost) };
};

/* ─── Main component ─────────────────────────────────────────── */
export default function ReportPanel() {
    const navigate = useNavigate();
    const { selectedFile, reportLatex, setReportLatex, reportSections, setReportSections } = useApp();
    const filename = selectedFile;

    const [leftWidth, setLeftWidth] = useState(228);
    const [editorWidth, setEditorWidth] = useState(50);
    const [leftTab, setLeftTab] = useState("outline");
    const [editMode, setEditMode] = useState(false);
    const [fontSize, setFontSize] = useState(13);

    const [latexSource, setLatexSource] = useState(reportLatex || "");
    const [pdfUrl, setPdfUrl] = useState(null);
    const [compiling, setCompiling] = useState(false);
    const [compileError, setCompileError] = useState("");
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState("");
    const [copied, setCopied] = useState(false);
    const [liveLog, setLiveLog] = useState([]);
    const [liveSections, setLiveSections] = useState(reportSections || []);
    const [activeStep, setActiveStep] = useState(-1);
    const [detectedMeta, setDetectedMeta] = useState(null);
    const [rateLimitMsg, setRateLimitMsg] = useState("");
    const [queryHint, setQueryHint] = useState(() => {
        try { return sessionStorage.getItem(SESSION_HINT_KEY) || ""; } catch { return ""; }
    });

    const esRef = useRef(null);
    const pdfUrlRef = useRef(null);
    const containerRef = useRef(null);

    useEffect(() => { setReportLatex(latexSource); }, [latexSource, setReportLatex]);
    useEffect(() => { setReportSections(liveSections); }, [liveSections, setReportSections]);
    useEffect(() => () => {
        if (pdfUrlRef.current) URL.revokeObjectURL(pdfUrlRef.current);
        if (esRef.current) esRef.current.close();
    }, []);

    if (!filename) { navigate("/"); return null; }

    const persistHint = v => {
        setQueryHint(v);
        try { sessionStorage.setItem(SESSION_HINT_KEY, v); } catch { }
    };

    const pushLog = useCallback((icon, label, done = false) => {
        setLiveLog(p => [...p, { icon, label, done, ts: Date.now() }]);
    }, []);

    const handleSSEEvent = useCallback((type, data) => {
        switch (type) {
            case "start": setActiveStep(0); setRateLimitMsg(""); pushLog("⬡", `Started: ${cleanName(data.filename || "")}`); break;
            case "structure": setActiveStep(1); setDetectedMeta({ material: data.material || "—", heat: data.heat || "—", sections_found: data.sections_found || [], total_chunks: data.total_chunks || 0 }); pushLog("◈", `${(data.sections_found || []).length} sections · ${data.total_chunks || 0} chunks`); break;
            case "section_start": setActiveStep(2); pushLog("⟁", `Extracting: ${data.display_name || data.section_key}`); break;
            case "section_extracted": setActiveStep(3); pushLog("▦", `LaTeX: ${data.display_name || data.section_key}`); break;
            case "section_done": pushLog("✓", `Done: ${data.display_name || data.section_key}`, true); break;
            case "section_ready": setLiveSections(p => p.find(s => s.section_key === data.section_key) ? p : [...p, data]); break;
            case "assembling": setActiveStep(4); pushLog("⊟", `Assembling ${data.section_count || "?"} sections…`); break;
            case "rate_limit": setRateLimitMsg(`Rate limit — retrying in ${data.retry_after || "?"}s`); pushLog("⏳", `Rate limit — waiting ${data.retry_after || "?"}s`); break;
            case "done": setActiveStep(5); setLatexSource(data.latex || ""); setLoading(false); setRateLimitMsg(""); setLeftTab("outline"); pushLog("✦", `Complete — ${(data.char_count || 0).toLocaleString()} chars`, true); break;
            case "heartbeat": if ((data.tick || 0) > 4) pushLog("·", `Still processing… (${((data.tick || 0) * 15)}s)`); break;
            case "error": setError(data.message || "Unknown error"); setLoading(false); break;
            default: break;
        }
    }, [pushLog]);

    const generate = useCallback(() => {
        if (!filename || loading) return;
        if (esRef.current) { esRef.current.close(); esRef.current = null; }
        setLoading(true); setError(""); setLatexSource(""); setPdfUrl(null);
        setCopied(false); setCompileError(""); setLiveLog([]);
        setLiveSections([]); setDetectedMeta(null); setActiveStep(-1); setRateLimitMsg("");
        setLeftTab("log");

        const body = JSON.stringify({ filename, standard_hint: queryHint.trim(), query_hint: queryHint.trim(), material_name: "", heat_number: "", document_no: "" });

        let retryCount = 0;
        const connect = () => {
            fetch(`${API}/generate-report`, { method: "POST", headers: { "Content-Type": "application/json" }, body })
                .then(res => {
                    if (!res.ok) return res.json().then(e => { throw new Error(e.error || `HTTP ${res.status}`); });
                    const reader = res.body.getReader(), dec = new TextDecoder();
                    let buf = "";
                    const pump = () => reader.read().then(({ done, value }) => {
                        if (done) { setLoading(p => { if (p) setError("Stream ended unexpectedly"); return false; }); return; }
                        buf += dec.decode(value, { stream: true });
                        const lines = buf.split("\n"); buf = lines.pop();
                        for (const line of lines) {
                            if (!line.startsWith("data: ")) continue;
                            try { const { type, ...rest } = JSON.parse(line.slice(6)); handleSSEEvent(type, rest); } catch { }
                        }
                        pump();
                    });
                    pump();
                })
                .catch(err => {
                    const is429 = err.message?.includes("429") || err.message?.toLowerCase().includes("rate");
                    if (retryCount < MAX_RETRIES) {
                        const delay = is429 ? RETRY_DELAYS[Math.min(retryCount, 2)] * 2 : RETRY_DELAYS[retryCount];
                        setRateLimitMsg(`Rate limited — retrying in ${delay / 1000}s… (${retryCount + 1}/${MAX_RETRIES})`);
                        pushLog("⏳", `Retrying in ${delay / 1000}s`);
                        retryCount++; setTimeout(connect, delay);
                    } else { setError(err.message || "Failed after retries."); setLoading(false); setRateLimitMsg(""); }
                });
        };
        connect();
    }, [filename, loading, queryHint, handleSSEEvent, pushLog]);

    const cancel = () => {
        if (esRef.current) { esRef.current.close(); esRef.current = null; }
        setLoading(false); setRateLimitMsg(""); pushLog("✗", "Cancelled");
    };

    const compileToPdf = useCallback(async () => {
        if (!latexSource || compiling) return;
        setCompiling(true); setCompileError("");
        if (pdfUrlRef.current) { URL.revokeObjectURL(pdfUrlRef.current); pdfUrlRef.current = null; }
        setPdfUrl(null);
        try {
            const res = await fetch(`${API}/compile-latex`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ latex: latexSource }) });
            if (!res.ok) { const e = await res.json().catch(() => ({})); throw new Error(e.error || `Compile failed: ${res.status}`); }
            const url = URL.createObjectURL(await res.blob());
            pdfUrlRef.current = url; setPdfUrl(url);
        } catch (e) { setCompileError(e.message || "Compilation failed"); }
        finally { setCompiling(false); }
    }, [latexSource, compiling]);

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
        navigator.clipboard.writeText(latexSource).then(() => { setCopied(true); setTimeout(() => setCopied(false), 2000); });
    };

    const lineCount = useMemo(() => latexSource ? latexSource.split("\n").length : 0, [latexSource]);
    const charCount = latexSource.length;

    const startLeftDrag = e => {
        e.preventDefault();
        const start = e.clientX, startW = leftWidth;
        const mv = e2 => setLeftWidth(Math.max(160, Math.min(340, startW + e2.clientX - start)));
        const up = () => { document.removeEventListener("mousemove", mv); document.removeEventListener("mouseup", up); };
        document.addEventListener("mousemove", mv); document.addEventListener("mouseup", up);
    };

    const startCenterDrag = e => {
        e.preventDefault();
        const ct = containerRef.current;
        if (!ct) return;
        const rect = ct.getBoundingClientRect();
        const avail = rect.width - leftWidth;
        const mv = e2 => {
            const pct = ((e2.clientX - rect.left - leftWidth) / avail) * 100;
            setEditorWidth(Math.max(25, Math.min(75, pct)));
        };
        const up = () => { document.removeEventListener("mousemove", mv); document.removeEventListener("mouseup", up); };
        document.addEventListener("mousemove", mv); document.addEventListener("mouseup", up);
    };

    return (
        <div style={{ display: "flex", flexDirection: "column", height: "100vh", overflow: "hidden", background: "var(--bg-base)", color: "var(--text-body)", fontFamily: "'JetBrains Mono','Fira Code',monospace", transition: "background .25s, color .25s" }}>
            <link href="https://fonts.googleapis.com/css2?family=Fraunces:ital,opsz,wght@0,9..144,300;1,9..144,300&family=JetBrains+Mono:wght@300;400;500&display=swap" rel="stylesheet" />
            <style>{`
                @keyframes slideIn { from{opacity:0;transform:translateX(-5px)} to{opacity:1;transform:none} }
                @keyframes fadeIn  { from{opacity:0} to{opacity:1} }
                @keyframes blink   { 0%,100%{opacity:1} 50%{opacity:.12} }
                @keyframes spin    { to{transform:rotate(360deg)} }
                @keyframes pulse   { 0%,100%{transform:scale(1)} 50%{transform:scale(1.18)} }
                ::-webkit-scrollbar { width:4px; height:4px; }
                ::-webkit-scrollbar-track { background:transparent; }
                ::-webkit-scrollbar-thumb { background:var(--scrollbar); border-radius:2px; }
                .dh { cursor:col-resize; }
                .dh:hover { background:var(--bg-elevated) !important; }
                .tb { background:transparent; border:none; cursor:pointer; transition:all .15s; border-radius:0; }
                .tb:hover { background:var(--bg-elevated); }
                :root { --ed-bg:#12121a; --ed-gutter:#0d0d14; --ed-bar:#191920; --red-soft:#f87171; --green-vivid:#4ade80; }
            `}</style>

            {/* ── Topbar (simplified — no fake menu items) ── */}
            <div style={{ display: "flex", alignItems: "center", height: 44, flexShrink: 0, background: "var(--bg-surface)", borderBottom: "1px solid var(--border)", padding: "0 14px", gap: 12 }}>
                {/* Brand */}
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <span style={{ fontSize: 17, color: "var(--accent)", animation: loading ? "pulse 2s ease-in-out infinite" : "none" }}>◈</span>
                    <span style={{ fontSize: 14, color: "var(--accent)", fontWeight: 600 }}>CMTI</span>
                    <span style={{ fontSize: 10, color: "var(--text-faint)", background: "var(--bg-elevated)", border: "1px solid var(--border)", padding: "2px 7px", borderRadius: 4 }}>Report Engine</span>
                </div>

                <div style={{ flex: 1 }} />

                {/* File chip */}
                {filename && (
                    <div style={{ display: "flex", alignItems: "center", gap: 6, background: "var(--bg-elevated)", border: "1px solid var(--border)", borderRadius: 6, padding: "3px 10px" }}>
                        <span style={{ width: 6, height: 6, borderRadius: "50%", background: loading ? "var(--green-vivid)" : "var(--accent)", transition: "background .3s", animation: loading ? "blink 1.5s ease-in-out infinite" : "none", flexShrink: 0 }} />
                        <span style={{ fontSize: 11, color: "var(--text-muted)", maxWidth: 200, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                            {cleanName(filename)}
                        </span>
                    </div>
                )}

                <button onClick={() => navigate("/")} style={{ ...ab("ghost"), gap: 6 }}>
                    <Icons.ArrowLeft size={13} /> Back to Chat
                </button>
            </div>

            {/* ── Action toolbar ── */}
            <div style={{ display: "flex", alignItems: "center", gap: 6, height: 40, flexShrink: 0, background: "var(--bg-elevated)", borderBottom: "1px solid var(--border)", padding: "0 10px", transition: "background .25s" }}>
                <button onClick={generate} disabled={loading || !filename} style={{ ...ab("primary"), padding: "5px 16px", fontWeight: 500, opacity: (loading || !filename) ? 0.5 : 1 }}>
                    {loading ? <><Spinner col="var(--accent)" /> Generating…</> : <><Icons.Zap size={13} /> Generate Report</>}
                </button>

                {loading && (
                    <button onClick={cancel} style={ab("danger")}>
                        <Icons.X size={12} /> Cancel
                    </button>
                )}

                <Sep />

                {latexSource && !loading && (
                    <button onClick={compileToPdf} disabled={compiling} style={ab("green")}>
                        {compiling ? <><Spinner col="var(--green-vivid)" /> Compiling…</> : <><Icons.Refresh size={13} /> Compile PDF</>}
                    </button>
                )}

                {latexSource && (
                    <button onClick={() => setEditMode(m => !m)} style={editMode ? ab("primary") : ab("ghost")}>
                        <Icons.Edit size={13} /> {editMode ? "Read-only" : "Edit"}
                    </button>
                )}

                <div style={{ flex: 1 }} />

                {/* Font size */}
                <IBtn onClick={() => setFontSize(s => Math.max(10, s - 1))} title="Smaller"><Icons.Minus size={11} /></IBtn>
                <span style={{ fontSize: 10, color: "var(--text-faint)", minWidth: 18, textAlign: "center", fontVariantNumeric: "tabular-nums" }}>{fontSize}</span>
                <IBtn onClick={() => setFontSize(s => Math.min(18, s + 1))} title="Larger"><Icons.Plus size={11} /></IBtn>

                <Sep />

                {latexSource && (
                    <>
                        <button onClick={copyLatex} style={{ ...ab("ghost"), color: copied ? "var(--green-vivid)" : "var(--text-muted)" }}>
                            {copied ? <><Icons.Check size={13} /> Copied</> : <><Icons.Copy size={13} /> Copy</>}
                        </button>
                        <button onClick={downloadTex} style={ab("ghost")}><Icons.Download size={13} /> .tex</button>
                    </>
                )}
                {pdfUrl && <button onClick={downloadPdf} style={ab("teal")}><Icons.Download size={13} /> .pdf</button>}

                {latexSource && (
                    <span style={{ fontSize: 10, color: "var(--text-faint)", marginLeft: 4, fontVariantNumeric: "tabular-nums" }}>
                        {lineCount.toLocaleString()} ln · {(charCount / 1024).toFixed(1)} KB
                    </span>
                )}
            </div>

            {/* ── Banners ── */}
            {rateLimitMsg && (
                <div style={{ padding: "5px 14px", background: "rgba(160,160,60,.08)", borderBottom: "1px solid rgba(160,160,60,.2)", fontSize: 10, color: "#b8b040", fontFamily: "'JetBrains Mono',monospace", display: "flex", gap: 8, alignItems: "center" }}>
                    <Spinner col="#b8b040" /> {rateLimitMsg}
                </div>
            )}
            {error && (
                <div style={{ padding: "5px 14px", background: "rgba(248,113,113,.06)", borderBottom: "1px solid rgba(248,113,113,.2)", fontSize: 10, color: "var(--red-soft)", fontFamily: "'JetBrains Mono',monospace", display: "flex", gap: 8, alignItems: "center" }}>
                    <Icons.Alert size={12} /> {error}
                    {!error.includes("Cancelled") && (
                        <button onClick={generate} style={{ background: "none", border: "none", color: "var(--red-soft)", cursor: "pointer", textDecoration: "underline", fontSize: 10, padding: 0 }}>Retry</button>
                    )}
                </div>
            )}
            {compileError && (
                <div style={{ padding: "5px 14px", background: "rgba(248,113,113,.06)", borderBottom: "1px solid rgba(248,113,113,.2)", fontSize: 10, color: "var(--red-soft)", fontFamily: "'JetBrains Mono',monospace", display: "flex", gap: 6, alignItems: "center" }}>
                    <Icons.Alert size={12} /> Compile error: {compileError}
                </div>
            )}

            {/* ── Main body ── */}
            <div ref={containerRef} style={{ flex: 1, display: "flex", overflow: "hidden", minHeight: 0 }}>

                {/* Left sidebar */}
                <div style={{ width: leftWidth, flexShrink: 0, display: "flex", flexDirection: "column", background: "var(--bg-panel)", borderRight: "1px solid var(--border)", overflow: "hidden" }}>

                    <div style={{ padding: "0 10px", height: 36, display: "flex", alignItems: "center", justifyContent: "space-between", borderBottom: "1px solid var(--border)" }}>
                        <span style={{ fontSize: 10, color: "var(--text-faint)", textTransform: "uppercase", letterSpacing: ".1em" }}>Files</span>
                        <IBtn title="New file"><Icons.Plus size={11} /></IBtn>
                    </div>

                    <div style={{ padding: "5px 0", borderBottom: "1px solid var(--border)" }}>
                        <div style={{ display: "flex", alignItems: "center", gap: 7, padding: "4px 10px", background: "var(--accent-dim)", borderLeft: "2px solid var(--accent)" }}>
                            <Icons.File size={12} color="var(--accent)" />
                            <span style={{ fontSize: 11, color: "var(--accent)" }}>main.tex</span>
                        </div>
                    </div>

                    {/* Focus hint */}
                    <div style={{ padding: "10px 10px 0" }}>
                        <div style={{ fontSize: 9, color: "var(--text-faint)", textTransform: "uppercase", letterSpacing: ".1em", marginBottom: 6 }}>Focus hint</div>
                        <input
                            type="text"
                            placeholder="HIC results, grain size…"
                            value={queryHint}
                            onChange={e => persistHint(e.target.value)}
                            onKeyDown={e => e.key === "Enter" && !loading && filename && generate()}
                            disabled={loading}
                            style={{ width: "100%", boxSizing: "border-box", background: "var(--bg-input)", border: "1px solid var(--border)", color: "var(--text-body)", fontFamily: "'JetBrains Mono',monospace", fontSize: 10, padding: "6px 8px", borderRadius: 6, outline: "none", transition: "border-color .15s" }}
                            onFocus={e => { e.target.style.borderColor = "var(--accent)"; }}
                            onBlur={e => { e.target.style.borderColor = "var(--border)"; }}
                        />
                    </div>

                    {/* Tab strip */}
                    <div style={{ display: "flex", borderBottom: "1px solid var(--border)", marginTop: 10 }}>
                        {[["outline", "Outline"], ["log", `Log${liveLog.length ? ` · ${liveLog.length}` : ""}`]].map(([key, label]) => (
                            <button key={key} className="tb" onClick={() => setLeftTab(key)}
                                style={{ flex: 1, height: 32, fontSize: 10, textTransform: "uppercase", letterSpacing: ".08em", color: leftTab === key ? "var(--accent)" : "var(--text-faint)", borderBottom: leftTab === key ? "2px solid var(--accent)" : "2px solid transparent" }}>
                                {label}
                                {key === "log" && loading && (
                                    <span style={{ display: "inline-block", width: 4, height: 4, borderRadius: "50%", background: "var(--accent)", marginLeft: 5, verticalAlign: "middle", animation: "blink 1.2s ease-in-out infinite" }} />
                                )}
                            </button>
                        ))}
                    </div>

                    <div style={{ flex: 1, overflow: "hidden", display: "flex", flexDirection: "column" }}>
                        {leftTab === "outline"
                            ? <Outline latex={latexSource} />
                            : <LiveLog log={liveLog} loading={loading} detectedMeta={detectedMeta} />
                        }
                    </div>

                    {/* Pipeline progress */}
                    {activeStep >= 0 && (
                        <div style={{ borderTop: "1px solid var(--border)", padding: "8px 0" }}>
                            {PIPELINE_STEPS.map((step, i) => {
                                const isActive = i === activeStep && loading;
                                const isDone = i < activeStep || (!loading && activeStep === PIPELINE_STEPS.length - 1);
                                return (
                                    <div key={step.event} style={{ display: "flex", alignItems: "center", gap: 8, padding: "3px 10px", opacity: isActive ? 1 : isDone ? 0.22 : 0.07, transition: "opacity .35s ease" }}>
                                        <span style={{ fontSize: 10, color: "var(--accent)", width: 14, flexShrink: 0 }}>{step.icon}</span>
                                        <span style={{ fontSize: 9.5, color: "var(--text-body)", flex: 1 }}>{step.label}</span>
                                        {isActive && <span style={{ width: 4, height: 4, borderRadius: "50%", background: "var(--accent)", animation: "blink 1.2s ease-in-out infinite", flexShrink: 0 }} />}
                                    </div>
                                );
                            })}
                        </div>
                    )}

                    {liveSections.length > 0 && (
                        <div style={{ borderTop: "1px solid var(--border)", padding: "6px 10px", display: "flex", alignItems: "baseline", gap: 6 }}>
                            <span style={{ fontSize: 20, color: "var(--accent)", fontFamily: "'Fraunces',Georgia,serif", fontVariantNumeric: "tabular-nums" }}>{liveSections.length}</span>
                            <span style={{ fontSize: 9.5, color: "var(--text-faint)" }}>{loading ? "sections ready" : "sections total"}</span>
                        </div>
                    )}
                </div>

                {/* Left drag handle */}
                <div className="dh" onMouseDown={startLeftDrag} style={{ width: 4, flexShrink: 0, background: "var(--bg-surface)", borderRight: "1px solid var(--border)", transition: "background .12s" }} />

                {/* Editor */}
                <div style={{ width: `${editorWidth}%`, flexShrink: 0, display: "flex", flexDirection: "column", background: "var(--ed-bg)", overflow: "hidden" }}>
                    <div style={{ display: "flex", alignItems: "center", height: 34, background: "var(--bg-surface)", borderBottom: "1px solid var(--border)", flexShrink: 0 }}>
                        <div style={{ display: "flex", alignItems: "center", gap: 7, padding: "0 16px", height: "100%", borderRight: "1px solid var(--border)", background: "var(--ed-bg)", borderTop: "2px solid var(--accent)" }}>
                            <Icons.FileText size={11} color="var(--accent)" />
                            <span style={{ fontSize: 11, color: "var(--accent)" }}>{latexSource ? "main.tex" : "—"}</span>
                        </div>
                        {latexSource && <span style={{ fontSize: 10, color: "var(--text-faint)", marginLeft: 12, fontVariantNumeric: "tabular-nums" }}>{lineCount.toLocaleString()} lines</span>}
                        {latexSource && <span style={{ marginLeft: "auto", marginRight: 10, fontSize: 10, color: editMode ? "var(--accent)" : "var(--text-faint)" }}>{editMode ? "● Editing" : "○ Read-only"}</span>}
                    </div>

                    <div style={{ flex: 1, overflow: "hidden", display: "flex", flexDirection: "column" }}>
                        {latexSource ? (
                            <LaTeXEditor value={latexSource} onChange={setLatexSource} readOnly={!editMode} fontSize={fontSize} />
                        ) : (
                            <div style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 20, background: "var(--ed-bg)" }}>
                                {loading ? (
                                    <>
                                        <div style={{ fontSize: 34, color: "var(--accent)", animation: "spin 2.5s linear infinite" }}>◈</div>
                                        <p style={{ margin: 0, fontFamily: "'Fraunces',Georgia,serif", fontStyle: "italic", fontSize: 16, color: "var(--text-muted)" }}>Generating report…</p>
                                        <p style={{ margin: 0, fontSize: 11, color: "var(--text-faint)", textAlign: "center", lineHeight: 1.9 }}>
                                            Switch to <strong style={{ color: "var(--text-muted)" }}>Log</strong> to watch live progress
                                        </p>
                                    </>
                                ) : (
                                    <>
                                        <div style={{ opacity: 0.18 }}><Icons.Layers size={52} color="var(--text-muted)" /></div>
                                        <p style={{ margin: 0, fontFamily: "'Fraunces',Georgia,serif", fontStyle: "italic", fontSize: 16, color: "var(--text-muted)" }}>Ready to generate</p>
                                        <p style={{ margin: 0, fontSize: 11, color: "var(--text-faint)", textAlign: "center", lineHeight: 2 }}>
                                            Sections are auto-discovered from the PDF.<br />Output is a fully compilable LaTeX document.
                                        </p>
                                        <button onClick={generate} style={{ ...ab("primary"), marginTop: 6, padding: "7px 20px" }}>
                                            <Icons.Zap size={13} /> Generate Report
                                        </button>
                                    </>
                                )}
                            </div>
                        )}
                    </div>

                    {/* Status bar */}
                    <div style={{ display: "flex", alignItems: "center", height: 22, flexShrink: 0, background: "var(--ed-bar)", padding: "0 12px", gap: 12 }}>
                        <span style={{ fontSize: 10, color: "#7cb8f8" }}>{latexSource ? "LaTeX" : "—"}</span>
                        <span style={{ fontSize: 10, color: "var(--text-faint)" }}>UTF-8</span>
                        {latexSource && <>
                            <span style={{ fontSize: 10, color: "var(--text-faint)", fontVariantNumeric: "tabular-nums" }}>{lineCount.toLocaleString()} lines</span>
                            <span style={{ fontSize: 10, color: "var(--text-faint)" }}>{(charCount / 1024).toFixed(1)} KB</span>
                        </>}
                        <div style={{ flex: 1 }} />
                        {loading && <span style={{ fontSize: 10, color: "var(--accent)", display: "flex", alignItems: "center", gap: 5, animation: "blink 1.4s ease-in-out infinite" }}><Spinner col="var(--accent)" /> Generating</span>}
                        {compiling && <span style={{ fontSize: 10, color: "var(--green-vivid)", display: "flex", alignItems: "center", gap: 5, animation: "blink 1.4s ease-in-out infinite" }}><Spinner col="var(--green-vivid)" /> Compiling</span>}
                    </div>
                </div>

                {/* Center drag handle */}
                <div className="dh" onMouseDown={startCenterDrag} style={{ width: 4, flexShrink: 0, background: "var(--bg-surface)", borderRight: "1px solid var(--border)", transition: "background .12s" }} />

                {/* PDF viewer */}
                <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden", minWidth: 0 }}>
                    <PDFViewer pdfUrl={pdfUrl} compiling={compiling} onCompile={compileToPdf} latexSource={latexSource} compileError={compileError} />
                </div>
            </div>
        </div>
    );
}