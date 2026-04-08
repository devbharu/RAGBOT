/**
 * ReportPanel.jsx — Metallurgy Report Engine v7.0
 * Complete redesign:
 * - Clean Claude-like layout, readable dark surfaces
 * - LaTeX highlighter rebuilt: simple, no clutter, no re-render artifacts
 * - Simple textarea editor — no virtualized line number jank
 * - Relaxed, spacious, professional feel
 */

import { useState, useRef, useEffect, useCallback, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { useApp, API } from "../context/AppContext";
import { useTheme } from "../context/ThemeContext";
import { Sun, Moon, ArrowLeft, FileText, Copy, Download, ChevronRight, RefreshCw, X } from "lucide-react";

const SESSION_HINT_KEY = "rp_query_hint_v5";
const MAX_RETRIES = 3;
const RETRY_DELAYS = [2000, 5000, 12000];

const PIPELINE_STEPS = [
    { event: "start", icon: "⬡", label: "Connecting" },
    { event: "structure", icon: "◈", label: "Reading structure" },
    { event: "section_start", icon: "⟁", label: "Extracting sections" },
    { event: "section_extracted", icon: "▦", label: "Writing LaTeX" },
    { event: "assembling", icon: "⊟", label: "Assembling" },
    { event: "done", icon: "✦", label: "Complete" },
];

const cleanName = (s = "") =>
    s.replace(/_pdf$/i, "").replace(/\.pdf$/i, "").replace(/_/g, " ").trim();

/* ─── Theme Toggle ───────────────────────────────────────────── */
const ThemeToggle = () => {
    const { isDark, toggleTheme } = useTheme();
    return (
        <button onClick={toggleTheme} className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-md border border-[var(--border-mid)] text-[var(--text-muted)] text-[11px] font-mono cursor-pointer transition-all hover:bg-[var(--bg-elevated)] hover:text-[var(--text-body)]" style={{ background: "transparent" }}>
            {isDark ? <Sun size={11} /> : <Moon size={11} />}
            {isDark ? "Light" : "Dark"}
        </button>
    );
};

/* ─── Structure tree ─────────────────────────────────────────── */
function StructurePane({ latex }) {
    const sections = useMemo(() => {
        if (!latex) return [];
        const result = [], re = /\\(section|subsection|subsubsection)\*?\{([^}]+)\}/g;
        let m;
        while ((m = re.exec(latex)) !== null)
            result.push({ level: m[1], title: m[2] });
        return result;
    }, [latex]);

    if (!sections.length)
        return (
            <div className="px-4 py-8 text-[var(--text-faint)] text-[11px] font-mono text-center leading-loose">
                Structure appears<br />after generation
            </div>
        );

    return (
        <div className="overflow-auto flex-1 py-1">
            {sections.map((s, i) => (
                <div key={i} className={`cursor-pointer overflow-hidden text-ellipsis whitespace-nowrap transition-colors hover:bg-[var(--bg-elevated)] py-1.5 border-b border-[var(--border)] ${s.level === "section" ? "px-3 text-[11.5px] text-[var(--accent)]" : s.level === "subsection" ? "px-5 text-[11px] text-[var(--text-muted)]" : "px-7 text-[10.5px] text-[var(--text-faint)]"}`}
                    style={{ fontFamily: s.level === "section" ? "'Fraunces', serif" : "inherit", fontStyle: s.level === "section" ? "italic" : "normal" }}>
                    {s.level === "section" ? "§ " : s.level === "subsection" ? "› " : "· "}{s.title}
                </div>
            ))}
        </div>
    );
}

/* ─── Clean LaTeX Editor ─────────────────────────────────────── */
/*
 * Uses a simple <textarea> with a synchronized <pre> overlay for highlights.
 * The overlay sits behind the textarea (which has transparent text + caret).
 * This avoids all virtualization jank and re-render artifacts.
 */
const LATEX_COLORS = {
    comment: "#6a9955",
    command: "#7cb8f8",
    brace: "#e6c87a",
    math: "#56d0b8",
    number: "#b5cea8",
    special: "#dcdcaa",
    string: "#ce9178",
    default: "#d4d4cc",
};

function highlightLatex(code) {
    /* Returns HTML string with <span> tags. Runs once per render. */
    const escapeHtml = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

    const rules = [
        { re: /(%[^\n]*)/g, color: LATEX_COLORS.comment },
        { re: /(\$\$[\s\S]*?\$\$|\$[^$\n]*?\$)/g, color: LATEX_COLORS.math },
        { re: /(\\[a-zA-Z]+\*?)/g, color: LATEX_COLORS.command },
        { re: /([{}])/g, color: LATEX_COLORS.brace },
        { re: /(\[|\])/g, color: LATEX_COLORS.string },
        { re: /\b(\d+(?:\.\d+)?(?:pt|em|cm|mm|in|ex)?)\b/g, color: LATEX_COLORS.number },
        { re: /([&_^~])/g, color: LATEX_COLORS.special },
    ];

    const len = code.length;
    const colors = new Array(len).fill(null);

    for (const { re, color } of rules) {
        re.lastIndex = 0;
        let m;
        while ((m = re.exec(code)) !== null) {
            for (let i = m.index; i < m.index + m[0].length; i++) {
                if (!colors[i]) colors[i] = color;
            }
        }
    }

    let html = "", i = 0;
    while (i < len) {
        const color = colors[i] || LATEX_COLORS.default;
        let j = i + 1;
        while (j < len && (colors[j] || LATEX_COLORS.default) === color) j++;
        const segment = escapeHtml(code.slice(i, j));
        html += `<span style="color:${color}">${segment}</span>`;
        i = j;
    }
    return html;
}

function LaTeXEditor({ value, onChange, readOnly = false, fontSize = 13 }) {
    const textareaRef = useRef(null);
    const preRef = useRef(null);
    const lineH = Math.round(fontSize * 1.72);
    const lines = value.split("\n").length;

    /* Sync scroll between textarea and highlight overlay */
    const syncScroll = () => {
        if (textareaRef.current && preRef.current) {
            preRef.current.scrollTop = textareaRef.current.scrollTop;
            preRef.current.scrollLeft = textareaRef.current.scrollLeft;
        }
    };

    /* Highlighted HTML — memoised so it only recomputes when value changes */
    const highlighted = useMemo(() => highlightLatex(value), [value]);

    const editorStyle = {
        fontFamily: "'JetBrains Mono', 'Fira Code', 'Cascadia Code', monospace",
        fontSize,
        lineHeight: `${lineH}px`,
        tabSize: 2,
        whiteSpace: "pre",
        overflowWrap: "normal",
    };

    return (
        <div className="flex flex-1 overflow-hidden min-h-0" style={{ background: "#13131a" }}>

            {/* Line numbers gutter */}
            <div className="flex-shrink-0 select-none border-r border-[#2a2a38] overflow-hidden" style={{ width: 52, background: "#13131a" }}>
                <div style={{ ...editorStyle, paddingTop: 8, paddingRight: 10, paddingLeft: 0, textAlign: "right", color: "#44445a", overflow: "hidden" }}>
                    {Array.from({ length: lines }, (_, i) => (
                        <div key={i} style={{ height: lineH }}>{i + 1}</div>
                    ))}
                </div>
            </div>

            {/* Code area — overlaid textarea on highlighted pre */}
            <div className="relative flex-1 overflow-hidden">
                {/* Highlight layer */}
                <pre
                    ref={preRef}
                    aria-hidden
                    style={{
                        ...editorStyle,
                        position: "absolute", inset: 0,
                        margin: 0,
                        padding: "8px 24px 8px 16px",
                        overflow: "hidden",
                        pointerEvents: "none",
                        userSelect: "none",
                    }}
                    dangerouslySetInnerHTML={{ __html: highlighted + "\n" }}
                />
                {/* Textarea layer */}
                <textarea
                    ref={textareaRef}
                    value={value}
                    onChange={readOnly ? undefined : (e) => onChange(e.target.value)}
                    onScroll={syncScroll}
                    readOnly={readOnly}
                    spellCheck={false}
                    autoCapitalize="off"
                    autoCorrect="off"
                    style={{
                        ...editorStyle,
                        position: "absolute", inset: 0,
                        margin: 0,
                        padding: "8px 24px 8px 16px",
                        background: "transparent",
                        color: "transparent",
                        caretColor: "#e6c87a",
                        border: "none",
                        outline: "none",
                        resize: "none",
                        width: "100%",
                        height: "100%",
                        overflowX: "auto",
                        overflowY: "auto",
                    }}
                />
            </div>
        </div>
    );
}

/* ─── Main Component ─────────────────────────────────────────── */
export default function ReportPanel() {
    const navigate = useNavigate();
    const { selectedFile, reportLatex, setReportLatex, reportSections, setReportSections } = useApp();
    const filename = selectedFile;

    const [view, setView] = useState("editor");
    const [editMode, setEditMode] = useState(false);
    const [latexSource, setLatexSource] = useState(reportLatex || "");
    const [pdfUrl, setPdfUrl] = useState(null);
    const [compiling, setCompiling] = useState(false);
    const [compileError, setCompileError] = useState("");
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState("");
    const [copied, setCopied] = useState(false);
    const [staleWarning, setStaleWarning] = useState(false);
    const [liveLog, setLiveLog] = useState([]);
    const [liveSections, setLiveSections] = useState(reportSections || []);
    const [activeStep, setActiveStep] = useState(-1);
    const [detectedMeta, setDetectedMeta] = useState(null);
    const [rateLimitMsg, setRateLimitMsg] = useState("");
    const [leftPanel, setLeftPanel] = useState("structure");
    const [fontSize, setFontSize] = useState(13);
    const [queryHint, setQueryHint] = useState(() => { try { return sessionStorage.getItem(SESSION_HINT_KEY) || ""; } catch { return ""; } });

    const esRef = useRef(null);
    const prevFile = useRef(filename);
    const pdfUrlRef = useRef(null);
    const logEndRef = useRef(null);

    const persistHint = (v) => { setQueryHint(v); try { sessionStorage.setItem(SESSION_HINT_KEY, v); } catch { } };

    useEffect(() => { setReportLatex(latexSource); }, [latexSource, setReportLatex]);
    useEffect(() => { setReportSections(liveSections); }, [liveSections, setReportSections]);
    useEffect(() => { if (latexSource && filename !== prevFile.current) setStaleWarning(true); prevFile.current = filename; }, [filename, latexSource]);
    useEffect(() => () => { if (pdfUrlRef.current) URL.revokeObjectURL(pdfUrlRef.current); if (esRef.current) esRef.current.close(); }, []);
    useEffect(() => { logEndRef.current?.scrollIntoView({ behavior: "smooth" }); }, [liveLog]);
    useEffect(() => { if (!filename) { alert("No document selected."); navigate("/"); } }, [filename, navigate]);

    const pushLog = useCallback((icon, label, done = false) => { setLiveLog((prev) => [...prev, { icon, label, done, ts: Date.now() }]); }, []);

    const handleSSEEvent = useCallback((type, data) => {
        switch (type) {
            case "start": setActiveStep(0); pushLog("⬡", `Started: ${cleanName(data.filename || "")}`); setRateLimitMsg(""); break;
            case "structure": setActiveStep(1); setDetectedMeta({ material: data.material || "—", heat: data.heat || "—", sections_found: data.sections_found || [], total_chunks: data.total_chunks || 0 }); pushLog("◈", `Found ${(data.sections_found || []).length} sections · ${data.total_chunks || 0} chunks`); break;
            case "section_start": setActiveStep(2); pushLog("⟁", `Extracting: ${data.display_name || data.section_key}`); break;
            case "section_extracted": setActiveStep(3); pushLog("▦", `Writing LaTeX: ${data.display_name || data.section_key}`); break;
            case "section_done": pushLog("✓", `Done: ${data.display_name || data.section_key}`, true); break;
            case "section_ready": setLiveSections((prev) => { if (prev.find((s) => s.section_key === data.section_key)) return prev; return [...prev, data]; }); break;
            case "assembling": setActiveStep(4); pushLog("⊟", `Assembling ${data.section_count || "?"} sections...`); break;
            case "rate_limit": setRateLimitMsg(`Rate limit — retrying in ${data.retry_after || "?"}s`); pushLog("⏳", `Rate limit — waiting ${data.retry_after || "?"}s`); break;
            case "done": setActiveStep(5); setLatexSource(data.latex || ""); setLoading(false); setRateLimitMsg(""); pushLog("✦", `Complete — ${(data.char_count || 0).toLocaleString()} chars`, true); setView("editor"); break;
            case "heartbeat": if ((data.tick || 0) > 4) pushLog("·", `Still processing... (${((data.tick || 0) * 15)}s elapsed)`); break;
            case "error": setError(data.message || "Unknown error"); setLoading(false); break;
            default: break;
        }
    }, [pushLog]);

    const generate = useCallback(() => {
        if (!filename || loading) return;
        if (esRef.current) { esRef.current.close(); esRef.current = null; }
        setLoading(true); setError(""); setLatexSource(""); setPdfUrl(null);
        setCopied(false); setStaleWarning(false); setCompileError("");
        setLiveLog([]); setLiveSections([]); setDetectedMeta(null);
        setActiveStep(-1); setRateLimitMsg("");

        const body = JSON.stringify({ filename, standard_hint: queryHint.trim(), query_hint: queryHint.trim(), material_name: "", heat_number: "", document_no: "" });

        let retryCount = 0;
        const connectSSE = () => {
            fetch(`${API}/generate-report`, { method: "POST", headers: { "Content-Type": "application/json" }, body })
                .then((res) => {
                    if (!res.ok) return res.json().then((e) => { throw new Error(e.error || `HTTP ${res.status}`); });
                    const reader = res.body.getReader(), decoder = new TextDecoder();
                    let buffer = "";
                    const pump = () => reader.read().then(({ done, value }) => {
                        if (done) { setLoading((prev) => { if (prev) setError("Stream ended unexpectedly"); return false; }); return; }
                        buffer += decoder.decode(value, { stream: true });
                        const lines = buffer.split("\n"); buffer = lines.pop();
                        for (const line of lines) { if (!line.startsWith("data: ")) continue; try { const { type, ...rest } = JSON.parse(line.slice(6)); handleSSEEvent(type, rest); } catch { } }
                        pump();
                    });
                    pump();
                })
                .catch((err) => {
                    const is429 = err.message?.includes("429") || err.message?.toLowerCase().includes("rate");
                    if (retryCount < MAX_RETRIES) {
                        const delay = is429 ? RETRY_DELAYS[Math.min(retryCount, 2)] * 2 : RETRY_DELAYS[retryCount];
                        setRateLimitMsg(`Rate limited — retrying in ${delay / 1000}s... (${retryCount + 1}/${MAX_RETRIES})`);
                        pushLog("⏳", `Retrying in ${delay / 1000}s`);
                        retryCount++;
                        setTimeout(connectSSE, delay);
                    } else { setError(err.message || "Failed after retries."); setLoading(false); setRateLimitMsg(""); }
                });
        };
        connectSSE();
    }, [filename, loading, queryHint, handleSSEEvent, pushLog]);

    const cancel = () => { if (esRef.current) { esRef.current.close(); esRef.current = null; } setLoading(false); setRateLimitMsg(""); pushLog("✗", "Cancelled"); };

    const compileToPdf = useCallback(async () => {
        if (!latexSource || compiling) return;
        setCompiling(true); setCompileError("");
        if (pdfUrlRef.current) { URL.revokeObjectURL(pdfUrlRef.current); pdfUrlRef.current = null; }
        setPdfUrl(null);
        try {
            const res = await fetch(`${API}/compile-latex`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ latex: latexSource }) });
            if (!res.ok) { const e = await res.json().catch(() => ({})); throw new Error(e.error || `Compile failed: ${res.status}`); }
            const url = URL.createObjectURL(await res.blob());
            pdfUrlRef.current = url; setPdfUrl(url); setView("report");
        } catch (e) { setCompileError(e.message || "Compilation failed"); }
        finally { setCompiling(false); }
    }, [latexSource, compiling]);

    const downloadTex = () => { if (!latexSource) return; const url = URL.createObjectURL(new Blob([latexSource], { type: "text/plain" })); Object.assign(document.createElement("a"), { href: url, download: cleanName(filename) + "_report.tex" }).click(); URL.revokeObjectURL(url); };
    const downloadPdf = () => { if (!pdfUrl) return; Object.assign(document.createElement("a"), { href: pdfUrl, download: cleanName(filename) + "_report.pdf" }).click(); };
    const copyLatex = () => { if (!latexSource) return; navigator.clipboard.writeText(latexSource).then(() => { setCopied(true); setTimeout(() => setCopied(false), 2000); }); };

    const lineCount = useMemo(() => (latexSource ? latexSource.split("\n").length : 0), [latexSource]);
    const charCount = latexSource.length;

    /* ── Shared styles ── */
    const monoFont = "'JetBrains Mono', 'Fira Code', monospace";
    const serifFont = "'Fraunces', Georgia, serif";

    const Btn = ({ onClick, disabled, children, variant = "ghost", className = "" }) => {
        const base = "inline-flex items-center justify-center gap-1.5 rounded-md font-mono cursor-pointer transition-all disabled:opacity-40 disabled:cursor-not-allowed text-[11.5px] px-3 py-1.5 border";
        const variants = {
            ghost: "bg-transparent border-[var(--border-mid)] text-[var(--text-muted)] hover:bg-[var(--bg-elevated)] hover:text-[var(--text-body)]",
            primary: "bg-[var(--accent)] border-[var(--accent)] text-[#09090c] font-bold hover:bg-[var(--accent-hover)]",
            teal: "bg-[var(--teal-dim)] border-[var(--teal)]/25 text-[var(--teal)] hover:bg-[var(--teal)]/15",
            danger: "bg-transparent border-red-800/30 text-red-400 hover:bg-red-950/20",
        };
        return <button onClick={onClick} disabled={disabled} className={`${base} ${variants[variant]} ${className}`}>{children}</button>;
    };

    /* ── PDF view ── */
    if (view === "report") {
        return (
            <div className="flex flex-col h-screen overflow-hidden" style={{ fontFamily: monoFont, background: "var(--bg-surface)", color: "var(--text-body)" }}>
                <link href="https://fonts.googleapis.com/css2?family=Fraunces:ital,opsz,wght@0,9..144,300;1,9..144,300&family=JetBrains+Mono:wght@300;400;500&display=swap" rel="stylesheet" />
                <div className="flex items-center gap-2 px-5 h-12 border-b border-[var(--border)] flex-shrink-0" style={{ background: "var(--bg-panel)" }}>
                    <Btn onClick={() => navigate("/")}>← Chat</Btn>
                    <Btn onClick={() => setView("editor")}>← Editor</Btn>
                    <span className="text-[var(--text-faint)] px-1">·</span>
                    <span className="text-[13px] text-[var(--text-primary)]" style={{ fontFamily: serifFont, fontStyle: "italic" }}>{cleanName(filename)} — PDF Preview</span>
                    <div className="ml-auto flex gap-2">
                        <ThemeToggle />
                        <Btn onClick={downloadPdf}><Download size={11} /> PDF</Btn>
                        <Btn onClick={downloadTex}><Download size={11} /> .tex</Btn>
                        <Btn onClick={() => setView("editor")} variant="primary">Edit LaTeX</Btn>
                    </div>
                </div>
                {pdfUrl
                    ? <iframe src={pdfUrl} className="flex-1 border-none bg-white" title="Compiled PDF" />
                    : (
                        <div className="flex-1 flex flex-col items-center justify-center gap-4">
                            <div className="text-4xl text-[var(--border-mid)]">⬡</div>
                            <p className="text-[var(--text-muted)]" style={{ fontFamily: serifFont, fontStyle: "italic" }}>No compiled PDF yet</p>
                            <Btn onClick={compileToPdf} disabled={!latexSource || compiling} variant="primary">{compiling ? "⟳ Compiling..." : "⬡ Compile → PDF"}</Btn>
                            {compileError && <p className="text-red-400 text-xs font-mono">{compileError}</p>}
                        </div>
                    )}
            </div>
        );
    }

    /* ── Main editor view ── */
    return (
        <div className="flex flex-col h-screen overflow-hidden" style={{ fontFamily: monoFont, background: "var(--bg-surface)", color: "var(--text-body)" }}>
            <link href="https://fonts.googleapis.com/css2?family=Fraunces:ital,opsz,wght@0,9..144,300;1,9..144,300&family=JetBrains+Mono:wght@300;400;500&display=swap" rel="stylesheet" />

            <style>{`
                @keyframes slideIn { from{opacity:0;transform:translateX(-4px)} to{opacity:1;transform:none} }
                @keyframes pulse   { 0%,100%{opacity:1} 50%{opacity:.3} }
                ::-webkit-scrollbar { width:3px; height:3px; }
                ::-webkit-scrollbar-track { background: transparent; }
                ::-webkit-scrollbar-thumb { background: var(--border-mid); border-radius: 2px; }
            `}</style>

            {/* ── Top bar ── */}
            <div className="flex items-center gap-2 px-5 h-12 border-b border-[var(--border)] flex-shrink-0" style={{ background: "var(--bg-panel)" }}>
                <Btn onClick={() => navigate("/")}><ArrowLeft size={11} /> Chat</Btn>

                <div className="flex items-center gap-2 ml-1">
                    <span className="text-[var(--accent)]">◈</span>
                    <span className="text-[13px] text-[var(--text-primary)]" style={{ fontFamily: serifFont, fontStyle: "italic" }}>Metallurgy Report Engine</span>
                </div>

                {filename && (
                    <div className="flex items-center gap-1.5 bg-[var(--bg-input)] border border-[var(--border)] rounded-md px-2.5 py-1">
                        <span className="w-1.5 h-1.5 rounded-full bg-[var(--accent)]" />
                        <span className="text-[11px] text-[var(--text-muted)] truncate max-w-[180px]">{cleanName(filename)}</span>
                    </div>
                )}

                {detectedMeta && (
                    <div className="flex items-center gap-1.5 bg-[var(--bg-input)] border border-[var(--border)] rounded-md px-2.5 py-1">
                        <span className="text-[11px] text-[var(--accent)]">{detectedMeta.material}</span>
                        {detectedMeta.heat !== "—" && <><span className="text-[var(--border-mid)]">·</span><span className="text-[11px] text-[var(--accent)]">Heat {detectedMeta.heat}</span></>}
                    </div>
                )}

                <div className="ml-auto flex items-center gap-2">
                    {latexSource && (
                        <>
                            <span className="text-[10px] text-[var(--text-faint)]">{lineCount.toLocaleString()} ln · {(charCount / 1024).toFixed(1)} KB</span>
                            <Btn onClick={() => setFontSize((s) => Math.max(10, s - 1))}>A−</Btn>
                            <Btn onClick={() => setFontSize((s) => Math.min(18, s + 1))}>A+</Btn>
                            <Btn onClick={() => setEditMode((m) => !m)} variant={editMode ? "primary" : "ghost"}>
                                {editMode ? "◉ Read" : "✎ Edit"}
                            </Btn>
                        </>
                    )}
                    {pdfUrl && <Btn onClick={() => setView("report")} variant="teal">⬡ Report</Btn>}
                    <ThemeToggle />
                </div>
            </div>

            {/* Banners */}
            {staleWarning && (
                <div className="flex items-center gap-2 px-5 py-2 bg-[var(--accent-dim)] border-b border-[var(--accent)]/20 text-[11.5px] text-[var(--accent)] font-mono">
                    ⚠ File changed — regenerate to refresh.
                    <button onClick={() => setStaleWarning(false)} className="ml-auto p-0.5 bg-transparent border-none cursor-pointer text-[var(--accent)]/60 hover:text-[var(--accent)]"><X size={11} /></button>
                </div>
            )}
            {rateLimitMsg && (
                <div className="flex items-center gap-2 px-5 py-1.5 border-b border-[var(--border)] text-[11px] text-[var(--text-muted)] font-mono" style={{ background: "var(--bg-input)" }}>
                    <span style={{ animation: "spin 1s linear infinite", display: "inline-block" }}>⟳</span>{rateLimitMsg}
                </div>
            )}

            {/* ── Body ── */}
            <div className="flex-1 flex overflow-hidden min-h-0">

                {/* ── Left sidebar: controls ── */}
                <div className="w-[210px] flex-shrink-0 border-r border-[var(--border)] flex flex-col gap-3 p-4 overflow-y-auto" style={{ background: "var(--bg-panel)" }}>

                    {/* Focus hint */}
                    <div className="flex flex-col gap-1.5">
                        <label className="text-[10px] text-[var(--text-faint)] tracking-widest uppercase font-mono">Focus hint</label>
                        <input
                            type="text"
                            placeholder="e.g. HIC results, grain size…"
                            value={queryHint}
                            onChange={(e) => persistHint(e.target.value)}
                            onKeyDown={(e) => e.key === "Enter" && !loading && filename && generate()}
                            disabled={loading}
                            style={{ background: "var(--bg-input)", border: "1px solid var(--border-mid)", color: "var(--text-primary)", fontFamily: monoFont, fontSize: 11, padding: "7px 10px", borderRadius: 6, outline: "none", width: "100%", boxSizing: "border-box" }}
                            onFocus={(e) => { e.target.style.borderColor = "rgba(230,200,122,0.4)"; e.target.style.boxShadow = "0 0 0 2px var(--accent-dim)"; }}
                            onBlur={(e) => { e.target.style.borderColor = "var(--border-mid)"; e.target.style.boxShadow = "none"; }}
                        />
                    </div>

                    <Btn onClick={generate} disabled={loading || !filename} variant="primary" className="w-full justify-center">
                        {loading ? <><span className="w-3 h-3 rounded-full border-2 border-[#09090c]/30 border-t-[#09090c] animate-spin" /> Generating…</> : <><span>✦</span> Generate Report</>}
                    </Btn>

                    {loading && <Btn onClick={cancel} className="w-full justify-center">Cancel</Btn>}

                    {latexSource && !loading && (
                        <Btn onClick={compileToPdf} disabled={compiling} variant="teal" className="w-full justify-center">
                            {compiling ? <><span className="w-3 h-3 rounded-full border-2 border-[var(--teal)]/30 border-t-[var(--teal)] animate-spin" /> Compiling…</> : <>⬡ Compile → PDF</>}
                        </Btn>
                    )}

                    {pdfUrl && !loading && <Btn onClick={() => setView("report")} variant="teal" className="w-full justify-center">⬡ Open Report</Btn>}

                    {latexSource && !loading && (
                        <div className="flex gap-1.5 flex-wrap">
                            <Btn onClick={copyLatex}><Copy size={10} />{copied ? "Copied!" : "Copy"}</Btn>
                            <Btn onClick={downloadTex}><Download size={10} />.tex</Btn>
                            {pdfUrl && <Btn onClick={downloadPdf}><Download size={10} />.pdf</Btn>}
                        </div>
                    )}

                    {error && (
                        <div className="flex items-start gap-1.5 p-2.5 rounded-lg text-[11px] text-red-400 font-mono leading-relaxed" style={{ background: "rgba(127,29,29,0.12)", border: "1px solid rgba(127,29,29,0.25)" }}>
                            <span>✗</span>
                            <span className="flex-1">{error}</span>
                            {!error.includes("Cancelled") && <button onClick={generate} className="bg-none border-none text-red-400 cursor-pointer text-[10px] underline p-0">Retry</button>}
                        </div>
                    )}
                    {compileError && (
                        <div className="flex items-start gap-1.5 p-2.5 rounded-lg text-[11px] text-red-400 font-mono" style={{ background: "rgba(127,29,29,0.12)", border: "1px solid rgba(127,29,29,0.25)" }}>
                            <span>✗</span> <span>Compile: {compileError}</span>
                        </div>
                    )}

                    <div className="h-px" style={{ background: "var(--border)" }} />

                    {/* Pipeline progress */}
                    {activeStep >= 0 && (
                        <div className="rounded-lg overflow-hidden" style={{ border: "1px solid var(--border)", background: "var(--bg-input)" }}>
                            <div className="px-3 py-2 border-b text-[10px] text-[var(--accent)] font-mono tracking-wide" style={{ borderColor: "var(--border)", fontFamily: serifFont, fontStyle: "italic" }}>
                                {loading ? "Processing…" : "Complete"}
                            </div>
                            {PIPELINE_STEPS.map((step, i) => {
                                const isActive = i === activeStep && loading;
                                const isDone = i < activeStep || (!loading && activeStep === PIPELINE_STEPS.length - 1);
                                return (
                                    <div key={step.event} className="flex items-center gap-2 px-3 py-1 transition-opacity" style={{ opacity: isActive ? 1 : isDone ? 0.22 : 0.12 }}>
                                        <span className="text-[10px] text-[var(--accent)] w-3.5 text-center flex-shrink-0">{step.icon}</span>
                                        <span className="text-[10px] text-[var(--text-body)] flex-1">{step.label}</span>
                                        {isActive && <span className="w-1 h-1 rounded-full bg-[var(--accent)] flex-shrink-0" style={{ animation: "pulse 1.2s ease-in-out infinite" }} />}
                                    </div>
                                );
                            })}
                            {liveSections.length > 0 && (
                                <div className="flex items-baseline gap-1.5 px-3 py-2 border-t" style={{ borderColor: "var(--border)" }}>
                                    <span className="text-lg text-[var(--accent)]" style={{ fontFamily: serifFont }}>{liveSections.length}</span>
                                    <span className="text-[9.5px] text-[var(--text-faint)] font-mono">{loading ? "sections ready" : "sections total"}</span>
                                </div>
                            )}
                        </div>
                    )}
                </div>

                {/* ── Middle panel: structure / log ── */}
                <div className="w-[190px] flex-shrink-0 border-r border-[var(--border)] flex flex-col overflow-hidden" style={{ background: "var(--bg-surface)" }}>
                    {/* Tab strip */}
                    <div className="flex border-b flex-shrink-0" style={{ borderColor: "var(--border)" }}>
                        {[["structure", "Structure"], ["log", `Log · ${liveLog.length}`]].map(([key, label]) => (
                            <button key={key} onClick={() => setLeftPanel(key)} className="flex-1 h-9 text-[10px] tracking-widest uppercase font-mono transition-colors border-none cursor-pointer" style={{ background: "transparent", color: leftPanel === key ? "var(--accent)" : "var(--text-faint)", borderBottom: leftPanel === key ? "2px solid var(--accent)" : "2px solid transparent" }}>
                                {label}
                                {key === "log" && loading && <span className="inline-block w-1 h-1 rounded-full bg-[var(--accent)] ml-1.5 align-middle" style={{ animation: "pulse 1.2s ease-in-out infinite" }} />}
                            </button>
                        ))}
                    </div>

                    {leftPanel === "structure" && <StructurePane latex={latexSource} />}

                    {leftPanel === "log" && (
                        <div className="overflow-auto flex-1 py-1">
                            {detectedMeta && (
                                <div className="mx-2.5 my-2 rounded-lg px-3 py-2 text-[10px] leading-7 font-mono" style={{ background: "var(--bg-input)", border: "1px solid var(--border)" }}>
                                    {[["Material", detectedMeta.material], ["Heat No.", detectedMeta.heat], ["Sections", (detectedMeta.sections_found || []).length], ["Chunks", (detectedMeta.total_chunks || 0).toLocaleString()]].map(([k, v]) => (
                                        <div key={k} className="flex justify-between">
                                            <span style={{ color: "var(--text-faint)" }}>{k}</span>
                                            <span style={{ color: "var(--accent)" }}>{v}</span>
                                        </div>
                                    ))}
                                </div>
                            )}
                            {liveLog.map((entry, i) => (
                                <div key={i} className="flex items-center gap-2 px-3 py-1.5 border-b" style={{ borderColor: "var(--border)", animation: "slideIn .15s ease both" }}>
                                    <span className="text-[10px] w-3 flex-shrink-0" style={{ color: entry.done ? "var(--text-faint)" : "var(--accent)" }}>{entry.icon}</span>
                                    <span className="text-[10px] leading-relaxed flex-1" style={{ color: entry.done ? "var(--text-faint)" : "var(--text-body)" }}>{entry.label}</span>
                                    {i === liveLog.length - 1 && loading && <span className="w-1 h-1 rounded-full bg-[var(--accent)] flex-shrink-0" style={{ animation: "pulse 1.2s ease-in-out infinite" }} />}
                                </div>
                            ))}
                            <div ref={logEndRef} />
                            {!loading && liveLog.length === 0 && (
                                <div className="px-4 py-6 text-[var(--text-faint)] text-[10px] text-center font-mono">Generate a report to see live progress</div>
                            )}
                        </div>
                    )}
                </div>

                {/* ── Main editor area ── */}
                <div className="flex-1 flex flex-col min-w-0 min-h-0 overflow-hidden">

                    {/* Editor tab bar */}
                    <div className="flex items-center h-9 border-b px-4 flex-shrink-0" style={{ borderColor: "var(--border)", background: "var(--bg-panel)" }}>
                        <span className="text-[10px] text-[var(--text-faint)] font-mono">{latexSource ? "main.tex" : "—"}</span>
                        {latexSource && (
                            <span className="ml-3 text-[10px] text-[var(--text-faint)] font-mono">{lineCount.toLocaleString()} lines</span>
                        )}
                    </div>

                    {/* Editor content */}
                    <div className="flex-1 flex flex-col min-h-0 overflow-hidden">
                        {latexSource ? (
                            <LaTeXEditor
                                value={latexSource}
                                onChange={setLatexSource}
                                readOnly={!editMode}
                                fontSize={fontSize}
                            />
                        ) : (
                            /* Empty state */
                            <div className="flex-1 flex flex-col items-center justify-center gap-5" style={{ background: "var(--bg-base)" }}>
                                {loading ? (
                                    <>
                                        <div className="text-[32px] text-[var(--accent)]" style={{ animation: "spin 2s linear infinite" }}>◈</div>
                                        <p className="text-[var(--text-muted)] text-base m-0" style={{ fontFamily: serifFont, fontStyle: "italic" }}>Generating report…</p>
                                        <p className="text-[11px] text-[var(--text-faint)] text-center font-mono m-0">
                                            Switch to <strong style={{ color: "var(--text-muted)" }}>Log</strong> in the left panel<br />to watch section-by-section progress.
                                        </p>
                                    </>
                                ) : filename ? (
                                    <>
                                        <div className="text-[32px]" style={{ color: "var(--text-faint)" }}>∴</div>
                                        <p className="text-[var(--text-muted)] text-base m-0" style={{ fontFamily: serifFont, fontStyle: "italic" }}>Ready to generate</p>
                                        <p className="text-[11px] text-[var(--text-faint)] text-center font-mono m-0">
                                            Sections are auto-discovered from the PDF.<br />Output is a fully compilable LaTeX document.
                                        </p>
                                        <Btn onClick={generate} variant="primary" className="mt-2">✦ Generate Report</Btn>
                                    </>
                                ) : (
                                    <>
                                        <div className="text-[32px]" style={{ color: "var(--text-faint)" }}>⬡</div>
                                        <p className="text-[var(--text-muted)] m-0" style={{ fontFamily: serifFont, fontStyle: "italic" }}>No document selected</p>
                                        <Btn onClick={() => navigate("/")}>← Go to Chat</Btn>
                                    </>
                                )}
                            </div>
                        )}
                    </div>

                    {/* Status bar */}
                    <div className="flex items-center h-6 border-t px-3 flex-shrink-0 text-[10px] font-mono" style={{ borderColor: "var(--border)", background: "var(--bg-panel)" }}>
                        <span style={{ color: latexSource ? "var(--accent)" : "var(--text-faint)" }}>{latexSource ? "LaTeX" : "—"}</span>
                        <span className="ml-4 text-[var(--text-faint)]">UTF-8</span>
                        {latexSource && (
                            <>
                                <span className="ml-4 text-[var(--text-faint)]">{lineCount.toLocaleString()} lines</span>
                                <span className="ml-4 text-[var(--text-faint)]">{(charCount / 1024).toFixed(1)} KB</span>
                            </>
                        )}
                        <div className="ml-auto flex gap-3">
                            {loading && <span className="text-[var(--accent)]" style={{ animation: "pulse 1.4s ease-in-out infinite" }}>● Generating</span>}
                            {compiling && <span className="text-[var(--teal)]" style={{ animation: "pulse 1.4s ease-in-out infinite" }}>● Compiling</span>}
                            {!loading && latexSource && <span className="text-[var(--text-faint)]">Ready {editMode ? "· Editing" : "· Read-only"}</span>}
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
}