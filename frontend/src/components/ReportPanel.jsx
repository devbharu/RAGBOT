/**
 * ReportPanel.jsx — Metallurgy Report Engine (v6.0)
 * - Tailwind CSS throughout
 * - Dark/Light theme via ThemeContext + CSS variables
 * - Back button navigates to /
 */

import { useState, useRef, useEffect, useCallback, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { useApp, API } from "../context/AppContext";
import { useTheme } from "../context/ThemeContext";
import { Sun, Moon } from "lucide-react";

// ── Constants ──────────────────────────────────────────────────
const SESSION_HINT_KEY = "rp_query_hint_v5";
const MAX_RETRIES = 3;
const RETRY_DELAYS = [2000, 5000, 12000];

const PIPELINE_STEPS = [
    { event: "start", icon: "⬡", label: "Connecting to report engine" },
    { event: "structure", icon: "◈", label: "Discovering PDF structure" },
    { event: "section_start", icon: "⟁", label: "Extracting sections in parallel" },
    { event: "section_extracted", icon: "▦", label: "Writing LaTeX for sections" },
    { event: "assembling", icon: "⊟", label: "Stitching document together" },
    { event: "done", icon: "✦", label: "Report ready" },
];

// ── LaTeX Syntax Highlighter ───────────────────────────────────
const LATEX_TOKENS = [
    { name: "comment", pattern: /(%[^\n]*)/g, color: "#6A9955" },
    { name: "command", pattern: /(\\[a-zA-Z]+\*?)/g, color: "#569CD6" },
    { name: "brace", pattern: /([{}])/g, color: "#E6C87A" },
    { name: "bracket", pattern: /([[|\]])/g, color: "#CE9178" },
    { name: "math", pattern: /(\$[^$\n]*?\$|\$\$[\s\S]*?\$\$)/g, color: "#4EC9B0" },
    { name: "number", pattern: /\b(\d+(?:\.\d+)?)\b/g, color: "#B5CEA8" },
    { name: "special", pattern: /([&_^~])/g, color: "#DCDCAA" },
];

function tokenizeLine(line) {
    const spans = [];
    const used = new Uint8Array(line.length);
    for (const tok of LATEX_TOKENS) {
        tok.pattern.lastIndex = 0;
        let m;
        while ((m = tok.pattern.exec(line)) !== null) {
            const start = m.index, end = start + m[0].length;
            let overlap = false;
            for (let i = start; i < end; i++) if (used[i]) { overlap = true; break; }
            if (!overlap) {
                spans.push({ start, end, color: tok.color, text: m[0] });
                for (let i = start; i < end; i++) used[i] = 1;
            }
        }
    }
    spans.sort((a, b) => a.start - b.start);
    const parts = [];
    let cursor = 0;
    for (const sp of spans) {
        if (sp.start > cursor) parts.push({ text: line.slice(cursor, sp.start), color: "#D4D4D4" });
        parts.push({ text: sp.text, color: sp.color });
        cursor = sp.end;
    }
    if (cursor < line.length) parts.push({ text: line.slice(cursor), color: "#D4D4D4" });
    return parts;
}

// ── Virtualized highlighted code view ────────────────────────
function HighlightedView({ code, fontSize = 13 }) {
    const lines = useMemo(() => code.split("\n"), [code]);
    const containerRef = useRef(null);
    const [scroll, setScroll] = useState(0);
    const [height, setHeight] = useState(600);
    const lineH = fontSize * 1.75;
    const visibleCount = Math.ceil(height / lineH) + 4;
    const startIdx = Math.max(0, Math.floor(scroll / lineH) - 2);
    const endIdx = Math.min(lines.length, startIdx + visibleCount);

    useEffect(() => {
        const el = containerRef.current;
        if (!el) return;
        const ro = new ResizeObserver(() => setHeight(el.clientHeight));
        ro.observe(el);
        return () => ro.disconnect();
    }, []);

    return (
        <div
            ref={containerRef}
            onScroll={(e) => setScroll(e.target.scrollTop)}
            className="flex-1 overflow-auto bg-[#1E1E1E] relative flex"
            style={{ fontFamily: "'JetBrains Mono','Fira Code',monospace", fontSize, lineHeight: `${lineH}px` }}
        >
            {/* Line numbers */}
            <div
                className="sticky left-0 min-w-[52px] bg-[#1E1E1E] border-r border-[#333] select-none z-[2]"
                style={{ paddingTop: startIdx * lineH, paddingBottom: (lines.length - endIdx) * lineH }}
            >
                {lines.slice(startIdx, endIdx).map((_, i) => (
                    <div key={i + startIdx} className="flex items-center justify-end pr-3 text-[#555]"
                        style={{ height: lineH, fontSize: fontSize - 1 }}>
                        {i + startIdx + 1}
                    </div>
                ))}
            </div>
            {/* Code */}
            <div
                className="flex-1 overflow-x-auto min-w-0"
                style={{ paddingTop: startIdx * lineH, paddingBottom: (lines.length - endIdx) * lineH, paddingLeft: 16, paddingRight: 24 }}
            >
                {lines.slice(startIdx, endIdx).map((line, i) => {
                    const parts = tokenizeLine(line || " ");
                    return (
                        <div key={i + startIdx} className="flex items-center whitespace-pre" style={{ height: lineH }}>
                            {parts.map((p, j) => <span key={j} style={{ color: p.color }}>{p.text}</span>)}
                        </div>
                    );
                })}
            </div>
        </div>
    );
}

// ── Editable textarea with line numbers ───────────────────────
function EditableEditor({ value, onChange, fontSize = 13 }) {
    const textareaRef = useRef(null);
    const gutterRef = useRef(null);
    const lineH = fontSize * 1.75;
    const lines = value.split("\n");

    const syncScroll = () => {
        if (textareaRef.current && gutterRef.current)
            gutterRef.current.scrollTop = textareaRef.current.scrollTop;
    };

    return (
        <div className="flex-1 flex overflow-hidden bg-[#1E1E1E]">
            <div ref={gutterRef} className="min-w-[52px] bg-[#1E1E1E] border-r border-[#333] overflow-hidden select-none pt-2">
                {lines.map((_, i) => (
                    <div key={i} className="flex items-center justify-end pr-3 text-[#555]"
                        style={{ height: lineH, fontSize: fontSize - 1, fontFamily: "'JetBrains Mono',monospace" }}>
                        {i + 1}
                    </div>
                ))}
            </div>
            <textarea
                ref={textareaRef}
                value={value}
                onChange={(e) => onChange(e.target.value)}
                onScroll={syncScroll}
                spellCheck={false}
                className="flex-1 bg-transparent text-[#D4D4D4] border-none outline-none resize-none p-2 pl-4 pr-6"
                style={{ fontFamily: "'JetBrains Mono','Fira Code',monospace", fontSize, lineHeight: `${lineH}px`, caretColor: "#E6C87A", tabSize: 2 }}
            />
        </div>
    );
}

// ── Structure tree ─────────────────────────────────────────────
function StructurePane({ latex }) {
    const sections = useMemo(() => {
        if (!latex) return [];
        const result = [], re = /\\(section|subsection|subsubsection)\*?\{([^}]+)\}/g;
        let m;
        while ((m = re.exec(latex)) !== null)
            result.push({ level: m[1], title: m[2], line: latex.slice(0, m.index).split("\n").length });
        return result;
    }, [latex]);

    if (!sections.length)
        return (
            <div className="px-4 py-6 text-[var(--text-faint)] text-[11px] font-mono text-center leading-relaxed">
                Structure will appear<br />after generation
            </div>
        );

    return (
        <div className="overflow-auto flex-1">
            {sections.map((s, i) => (
                <div
                    key={i}
                    className={`border-b border-[var(--border)] cursor-pointer overflow-hidden text-ellipsis whitespace-nowrap transition-colors hover:bg-[var(--bg-elevated)] ${s.level === "section" ? "px-3 py-1.5 text-[11.5px] text-[var(--accent)]" :
                        s.level === "subsection" ? "px-[22px] py-1 text-[11px] text-[var(--text-muted)]" :
                            "px-8 py-0.5 text-[10.5px] text-[var(--text-faint)]"
                        }`}
                    style={{
                        fontFamily: s.level === "section" ? "Fraunces,Georgia,serif" : "inherit",
                        fontStyle: s.level === "section" ? "italic" : "normal",
                        lineHeight: 1.5,
                    }}
                >
                    {s.level === "section" ? "§ " : s.level === "subsection" ? "  › " : "    · "}
                    {s.title}
                </div>
            ))}
        </div>
    );
}

// ── Helpers ───────────────────────────────────────────────────
const cleanName = (s = "") =>
    s.replace(/_pdf$/i, "").replace(/\.pdf$/i, "").replace(/_/g, " ").trim();

// ── Theme Toggle ──────────────────────────────────────────────
const ThemeToggle = () => {
    const { isDark, toggleTheme } = useTheme();
    return (
        <button
            onClick={toggleTheme}
            className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-md bg-transparent border border-[var(--border-mid)] text-[var(--text-muted)] text-[11px] font-mono cursor-pointer transition-all hover:bg-[var(--bg-elevated)] hover:text-[var(--text-body)]"
        >
            {isDark ? <Sun size={11} /> : <Moon size={11} />}
            {isDark ? "Light" : "Dark"}
        </button>
    );
};

// ── Main Component ────────────────────────────────────────────
export default function ReportPanel() {
    const navigate = useNavigate();
    const {
        selectedFile,
        reportLatex, setReportLatex,
        reportSections, setReportSections,
    } = useApp();

    const filename = selectedFile;

    // ── state ──────────────────────────────────────────────────
    const [view, setView] = useState("editor");
    const [editorMode, setEditorMode] = useState("highlight");
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
    const [queryHint, setQueryHint] = useState(() => {
        try { return sessionStorage.getItem(SESSION_HINT_KEY) || ""; } catch { return ""; }
    });

    const esRef = useRef(null);
    const prevFile = useRef(filename);
    const pdfUrlRef = useRef(null);
    const logEndRef = useRef(null);

    const persistHint = (v) => {
        setQueryHint(v);
        try { sessionStorage.setItem(SESSION_HINT_KEY, v); } catch { }
    };

    useEffect(() => { setReportLatex(latexSource); }, [latexSource, setReportLatex]);
    useEffect(() => { setReportSections(liveSections); }, [liveSections, setReportSections]);

    useEffect(() => {
        if (latexSource && filename !== prevFile.current) setStaleWarning(true);
        prevFile.current = filename;
    }, [filename, latexSource]);

    useEffect(() => () => {
        if (pdfUrlRef.current) URL.revokeObjectURL(pdfUrlRef.current);
        if (esRef.current) esRef.current.close();
    }, []);

    useEffect(() => { logEndRef.current?.scrollIntoView({ behavior: "smooth" }); }, [liveLog]);

    useEffect(() => {
        if (!filename) {
            alert("No document selected. Please select a file from the chatbot first.");
            navigate("/");
        }
    }, [filename, navigate]);

    // ── Log helper ─────────────────────────────────────────────
    const pushLog = useCallback((icon, label, done = false) => {
        setLiveLog((prev) => [...prev, { icon, label, done, ts: Date.now() }]);
    }, []);

    // ── SSE event handler ──────────────────────────────────────
    const handleSSEEvent = useCallback((type, data) => {
        switch (type) {
            case "start":
                setActiveStep(0);
                pushLog("⬡", `Started: ${cleanName(data.filename || "")}`);
                setRateLimitMsg("");
                break;
            case "structure":
                setActiveStep(1);
                setDetectedMeta({
                    material: data.material || "—",
                    heat: data.heat || "—",
                    sections_found: data.sections_found || [],
                    total_chunks: data.total_chunks || 0,
                });
                pushLog("◈", `Found ${(data.sections_found || []).length} sections · ${data.total_chunks || 0} chunks`);
                break;
            case "section_start":
                setActiveStep(2);
                pushLog("⟁", `Extracting: ${data.display_name || data.section_key} (${data.chunk_count || 0} chunks)`);
                break;
            case "section_extracted":
                setActiveStep(3);
                pushLog("▦", `Writing LaTeX: ${data.display_name || data.section_key}`);
                break;
            case "section_done":
                pushLog("✓", `Done: ${data.display_name || data.section_key} (${(data.latex_chars || 0).toLocaleString()} chars)`, true);
                break;
            case "section_ready":
                setLiveSections((prev) => {
                    if (prev.find((s) => s.section_key === data.section_key)) return prev;
                    return [...prev, data];
                });
                break;
            case "assembling":
                setActiveStep(4);
                pushLog("⊟", `Assembling ${data.section_count || "?"} sections...`);
                break;
            case "rate_limit":
                setRateLimitMsg(`Rate limit hit — retrying in ${data.retry_after || "?"}s`);
                pushLog("⏳", `Rate limit — waiting ${data.retry_after || "?"}s`);
                break;
            case "done":
                setActiveStep(5);
                setLatexSource(data.latex || "");
                setLoading(false);
                setRateLimitMsg("");
                pushLog("✦", `Complete — ${(data.char_count || 0).toLocaleString()} chars`, true);
                setView("editor");
                break;
            case "heartbeat":
                if ((data.tick || 0) > 4)
                    pushLog("·", `Still processing... (${((data.tick || 0) * 15)}s elapsed)`);
                break;
            case "error":
                setError(data.message || "Unknown error from server");
                setLoading(false);
                break;
            default: break;
        }
    }, [pushLog]);

    // ── Generate ───────────────────────────────────────────────
    const generate = useCallback(() => {
        if (!filename || loading) return;
        if (esRef.current) { esRef.current.close(); esRef.current = null; }

        setLoading(true); setError(""); setLatexSource(""); setPdfUrl(null);
        setCopied(false); setStaleWarning(false); setCompileError("");
        setLiveLog([]); setLiveSections([]); setDetectedMeta(null);
        setActiveStep(-1); setRateLimitMsg("");

        const body = JSON.stringify({
            filename,
            standard_hint: queryHint.trim(),
            query_hint: queryHint.trim(),
            material_name: "", heat_number: "", document_no: "",
        });

        let retryCount = 0;
        const connectSSE = () => {
            fetch(`${API}/generate-report`, { method: "POST", headers: { "Content-Type": "application/json" }, body })
                .then((res) => {
                    if (!res.ok) return res.json().then((e) => { throw new Error(e.error || `HTTP ${res.status}`); });
                    const reader = res.body.getReader();
                    const decoder = new TextDecoder();
                    let buffer = "";
                    const pump = () => reader.read().then(({ done, value }) => {
                        if (done) { setLoading((prev) => { if (prev) setError("Stream ended unexpectedly"); return false; }); return; }
                        buffer += decoder.decode(value, { stream: true });
                        const lines = buffer.split("\n");
                        buffer = lines.pop();
                        for (const line of lines) {
                            if (!line.startsWith("data: ")) continue;
                            try {
                                const payload = JSON.parse(line.slice(6));
                                const { type, ...rest } = payload;
                                handleSSEEvent(type, rest);
                            } catch { }
                        }
                        pump();
                    });
                    pump();
                })
                .catch((err) => {
                    const is429 = err.message && (err.message.includes("429") || err.message.toLowerCase().includes("rate"));
                    if (retryCount < MAX_RETRIES) {
                        const delay = is429 ? RETRY_DELAYS[Math.min(retryCount, 2)] * 2 : RETRY_DELAYS[retryCount];
                        setRateLimitMsg(`Rate limited — retrying in ${delay / 1000}s... (${retryCount + 1}/${MAX_RETRIES})`);
                        pushLog("⏳", `${is429 ? "Rate limit" : "Error"} — retrying in ${delay / 1000}s`);
                        retryCount++;
                        setTimeout(connectSSE, delay);
                    } else {
                        setError(err.message || "Failed after retries.");
                        setLoading(false); setRateLimitMsg("");
                    }
                });
        };
        connectSSE();
    }, [filename, loading, queryHint, handleSSEEvent, pushLog]);

    const cancel = () => {
        if (esRef.current) { esRef.current.close(); esRef.current = null; }
        setLoading(false); setRateLimitMsg("");
        pushLog("✗", "Cancelled by user");
    };

    // ── Compile to PDF ─────────────────────────────────────────
    const compileToPdf = useCallback(async () => {
        if (!latexSource || compiling) return;
        setCompiling(true); setCompileError("");
        if (pdfUrlRef.current) { URL.revokeObjectURL(pdfUrlRef.current); pdfUrlRef.current = null; }
        setPdfUrl(null);
        try {
            const res = await fetch(`${API}/compile-latex`, {
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
            setView("report");
        } catch (e) {
            setCompileError(e.message || "Compilation failed");
        } finally {
            setCompiling(false);
        }
    }, [latexSource, compiling]);

    // ── Downloads ───────────────────────────────────────────────
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

    const lineCount = useMemo(() => (latexSource ? latexSource.split("\n").length : 0), [latexSource]);
    const charCount = latexSource.length;

    // ── RENDER: PDF report view ───────────────────────────────────
    if (view === "report") {
        return (
            <div className="flex flex-col h-screen overflow-hidden" style={{ fontFamily: "'JetBrains Mono','Fira Code',monospace", background: "var(--bg-surface)", color: "var(--text-body)" }}>
                <link href="https://fonts.googleapis.com/css2?family=Fraunces:ital,opsz,wght@0,9..144,300;1,9..144,300&family=JetBrains+Mono:wght@300;400;500&display=swap" rel="stylesheet" />
                <div className="flex items-center gap-3 px-5 h-12 border-b border-[var(--border)] flex-shrink-0 bg-[var(--bg-panel)]">
                    <button className="ghost-btn" onClick={() => navigate("/")}>← Back to Chat</button>
                    <button className="ghost-btn" onClick={() => setView("editor")}>← Editor</button>
                    <div className="flex items-center gap-2 ml-1">
                        <span className="text-[var(--accent)] text-sm">◈</span>
                        <span className="text-sm text-[var(--text-primary)]" style={{ fontFamily: "Fraunces,serif", fontStyle: "italic" }}>{cleanName(filename)} — PDF Preview</span>
                    </div>
                    <div className="ml-auto flex gap-2">
                        <ThemeToggle />
                        <button className="ghost-btn" onClick={downloadPdf}>↓ Download PDF</button>
                        <button className="ghost-btn" onClick={downloadTex}>↓ .tex source</button>
                        <button className="ghost-btn accent-btn" onClick={() => setView("editor")}>Edit LaTeX</button>
                    </div>
                </div>
                {pdfUrl
                    ? <iframe src={pdfUrl} className="flex-1 border-none bg-white" title="Compiled Report PDF" />
                    : (
                        <div className="flex-1 flex items-center justify-center flex-col gap-4">
                            <div className="text-[32px] text-[var(--border-mid)]">⬡</div>
                            <p className="text-[var(--text-muted)] text-base" style={{ fontFamily: "Fraunces,serif", fontStyle: "italic" }}>No compiled PDF yet</p>
                            <button className="primary-btn" onClick={compileToPdf} disabled={!latexSource || compiling}>
                                {compiling ? "⟳ Compiling..." : "⬡ Compile → PDF"}
                            </button>
                            {compileError && <p className="text-red-400 text-xs">{compileError}</p>}
                        </div>
                    )}
            </div>
        );
    }

    // ── RENDER: Main editor view ──────────────────────────────────
    return (
        <div className="flex flex-col h-screen overflow-hidden" style={{ fontFamily: "'JetBrains Mono','Fira Code',monospace", background: "var(--bg-surface)", color: "var(--text-body)" }}>
            <link href="https://fonts.googleapis.com/css2?family=Fraunces:ital,opsz,wght@0,9..144,300;1,9..144,300&family=JetBrains+Mono:wght@300;400;500&display=swap" rel="stylesheet" />
            <style>{`
                @keyframes spin    { to { transform: rotate(360deg); } }
                @keyframes pulse   { 0%,100% { opacity:1; } 50% { opacity:.2; } }
                @keyframes slideIn { from { opacity:0;transform:translateX(-5px); } to { opacity:1;transform:none; } }
                .rp-input { background:var(--bg-input); border:1px solid var(--border-mid); color:var(--text-primary); font-family:'JetBrains Mono',monospace; font-size:11px; padding:7px 10px; border-radius:5px; outline:none; width:100%; box-sizing:border-box; }
                .rp-input:focus { border-color:rgba(230,200,122,0.4); box-shadow:0 0 0 2px var(--accent-dim); }
                .rp-input::placeholder { color:var(--text-faint); }
                .primary-btn { display:inline-flex;align-items:center;justify-content:center;gap:6px;padding:0 16px;height:35px;font-size:11.5px;font-family:'JetBrains Mono',monospace;letter-spacing:.05em;background:var(--accent);color:#09090c;border:none;border-radius:5px;cursor:pointer;transition:opacity .15s; }
                .primary-btn:disabled { opacity:.5;cursor:not-allowed; }
                .primary-btn:not(:disabled):hover { opacity:.88; }
                .compile-btn { display:inline-flex;align-items:center;justify-content:center;gap:6px;padding:0 16px;height:35px;font-size:11.5px;font-family:'JetBrains Mono',monospace;letter-spacing:.05em;background:var(--teal-dim);color:var(--teal);border:1px solid var(--teal)/20;border-radius:5px;cursor:pointer; }
                .ghost-btn { display:inline-flex;align-items:center;justify-content:center;gap:5px;padding:0 11px;height:30px;font-size:11px;font-family:'JetBrains Mono',monospace;background:transparent;color:var(--text-muted);border:1px solid var(--border);border-radius:5px;cursor:pointer;transition:color .15s,border-color .15s,background .15s;white-space:nowrap; }
                .ghost-btn:hover { background:var(--bg-elevated);color:var(--text-body);border-color:var(--border-mid); }
                .accent-btn { color:var(--accent);border-color:var(--accent-dim); }
                .sm-btn { display:inline-flex;align-items:center;gap:4px;padding:0 9px;height:28px;font-size:10.5px;font-family:'JetBrains Mono',monospace;background:transparent;color:var(--text-muted);border:1px solid var(--border);border-radius:4px;cursor:pointer; }
                ::-webkit-scrollbar { width:3px;height:3px; }
                ::-webkit-scrollbar-track { background:transparent; }
                ::-webkit-scrollbar-thumb { background:var(--border-mid);border-radius:2px; }
            `}</style>

            {/* Topbar */}
            <div className="flex items-center gap-2.5 px-5 h-12 border-b border-[var(--border)] flex-shrink-0 bg-[var(--bg-panel)]">
                <button className="ghost-btn" onClick={() => navigate("/")}>← Chat</button>

                <div className="flex items-center gap-2">
                    <span className="text-[var(--accent)] text-sm">◈</span>
                    <span className="text-sm" style={{ fontFamily: "Fraunces,serif", fontStyle: "italic", color: "var(--text-primary)" }}>
                        Metallurgy Report Engine
                    </span>
                </div>

                {filename && (
                    <div className="flex items-center gap-1.5 bg-[var(--bg-input)] border border-[var(--border)] rounded px-2.5 py-0.5">
                        <span className="w-1.5 h-1.5 rounded-full bg-[var(--accent)] flex-shrink-0" />
                        <span className="text-[11.5px] text-[var(--text-muted)] font-mono truncate max-w-[200px]">{cleanName(filename)}</span>
                    </div>
                )}

                {detectedMeta && (
                    <div className="flex items-center gap-1.5 px-2 py-0.5 rounded bg-[var(--bg-input)] border border-[var(--border)]">
                        <span className="text-[10.5px] text-[var(--accent)] font-mono">{detectedMeta.material}</span>
                        {detectedMeta.heat !== "—" && (
                            <>
                                <span className="text-[var(--border-mid)]">·</span>
                                <span className="text-[10.5px] text-[var(--accent)] font-mono">Heat: {detectedMeta.heat}</span>
                            </>
                        )}
                    </div>
                )}

                <div className="ml-auto flex items-center gap-2">
                    {latexSource && (
                        <>
                            <span className="text-[10px] text-[var(--text-faint)] font-mono">
                                {lineCount.toLocaleString()} ln · {charCount.toLocaleString()} ch
                            </span>
                            <button className="ghost-btn" onClick={() => setFontSize((s) => Math.max(10, s - 1))}>A−</button>
                            <button className="ghost-btn" onClick={() => setFontSize((s) => Math.min(18, s + 1))}>A+</button>
                            <button
                                className={`ghost-btn ${editorMode === "edit" ? "accent-btn" : ""}`}
                                onClick={() => setEditorMode((m) => (m === "highlight" ? "edit" : "highlight"))}
                            >
                                {editorMode === "highlight" ? "✎ Edit" : "◉ Highlight"}
                            </button>
                        </>
                    )}
                    {pdfUrl && (
                        <button className="ghost-btn" style={{ color: "var(--teal)", borderColor: "var(--teal-dim)" }} onClick={() => setView("report")}>
                            ⬡ View Report
                        </button>
                    )}
                    <ThemeToggle />
                </div>
            </div>

            {/* Stale warning */}
            {staleWarning && (
                <div className="flex items-center gap-2 px-6 py-2 bg-[var(--accent-dim)] border-b border-[var(--accent)]/20 text-[11.5px] text-[var(--accent)] font-mono">
                    <span>⚠</span> File changed — regenerate to refresh the report.
                </div>
            )}

            {/* Rate limit banner */}
            {rateLimitMsg && (
                <div className="flex items-center gap-2 px-6 py-2 bg-[var(--bg-input)] border-b border-[var(--border)] text-[11px] text-[var(--text-muted)] font-mono">
                    <span className="animate-spin inline-block">⟳</span>
                    {rateLimitMsg}
                </div>
            )}

            {/* Body */}
            <div className="flex-1 flex overflow-hidden min-h-0">

                {/* Left sidebar */}
                <div className="w-[220px] flex-shrink-0 border-r border-[var(--border)] p-3.5 flex flex-col gap-2.5 overflow-y-auto bg-[var(--bg-panel)]">
                    <div className="flex flex-col gap-1.5">
                        <label className="text-[10px] text-[var(--text-faint)] tracking-widest uppercase font-mono flex items-center gap-1.5">
                            Focus hint <span className="text-[9.5px] border border-[var(--border)] rounded px-1 py-0.5 text-[var(--text-faint)]">optional</span>
                        </label>
                        <input
                            className="rp-input"
                            type="text"
                            placeholder="e.g. HIC test results, grain size..."
                            value={queryHint}
                            onChange={(e) => persistHint(e.target.value)}
                            onKeyDown={(e) => e.key === "Enter" && !loading && filename && generate()}
                            disabled={loading}
                        />
                    </div>

                    <div className="h-px bg-[var(--border)] my-0.5" />

                    <button className="primary-btn w-full" onClick={generate} disabled={loading || !filename}>
                        {loading
                            ? <><span className="w-2.5 h-2.5 rounded-full border-[1.5px] border-[var(--accent)]/25 border-t-[var(--accent)] animate-spin" /> Generating...</>
                            : <><span className="text-[10px]">✦</span> Generate Report</>}
                    </button>

                    {loading && (
                        <button className="ghost-btn w-full" onClick={cancel}>Cancel</button>
                    )}

                    {latexSource && !loading && (
                        <button className="compile-btn w-full" onClick={compileToPdf} disabled={compiling}>
                            {compiling
                                ? <><span className="w-2.5 h-2.5 rounded-full border-[1.5px] border-[var(--teal)]/25 border-t-[var(--teal)] animate-spin" /> Compiling...</>
                                : <><span>⬡</span> Compile → PDF</>}
                        </button>
                    )}

                    {pdfUrl && !loading && (
                        <button className="ghost-btn w-full" style={{ color: "var(--teal)", borderColor: "var(--teal-dim)" }} onClick={() => setView("report")}>
                            <span>⬡</span> Open Report Page
                        </button>
                    )}

                    {latexSource && !loading && (
                        <div className="flex gap-1.5 flex-wrap">
                            <button className="sm-btn" onClick={copyLatex}>{copied ? "✓ Copied" : "⊕ Copy"}</button>
                            <button className="sm-btn" onClick={downloadTex}>↓ .tex</button>
                            {pdfUrl && <button className="sm-btn" onClick={downloadPdf}>↓ .pdf</button>}
                        </div>
                    )}

                    {error && (
                        <div className="flex items-start gap-1.5 p-2.5 bg-red-950/20 border border-red-800/30 rounded text-[11px] text-red-400 font-mono leading-relaxed">
                            <span>✗</span>
                            <span className="flex-1">{error}</span>
                            {!error.includes("Cancelled") && (
                                <button className="bg-none border-none text-red-400 cursor-pointer text-[10px] underline p-0" onClick={generate}>Retry</button>
                            )}
                        </div>
                    )}
                    {compileError && (
                        <div className="flex items-start gap-1.5 p-2.5 bg-red-950/20 border border-red-800/30 rounded text-[11px] text-red-400 font-mono">
                            <span>✗</span> <span>Compile: {compileError}</span>
                        </div>
                    )}

                    <div className="h-px bg-[var(--border)] my-0.5" />

                    {/* Pipeline steps */}
                    {activeStep >= 0 && (
                        <div className="bg-[var(--bg-input)] border border-[var(--border)] rounded-md overflow-hidden">
                            <div className="text-[10px] text-[var(--accent)] font-mono px-3 py-2 border-b border-[var(--border)] tracking-wide" style={{ fontFamily: "Fraunces,serif", fontStyle: "italic" }}>
                                {loading ? "Processing..." : "Complete"}
                            </div>
                            {PIPELINE_STEPS.map((step, i) => {
                                const isActive = i === activeStep && loading;
                                const isDone = i < activeStep || (!loading && activeStep === PIPELINE_STEPS.length - 1);
                                return (
                                    <div key={step.event} className={`flex items-center gap-2 px-3 py-1 relative transition-opacity ${isActive ? "opacity-100" : isDone ? "opacity-20" : "opacity-10"}`}>
                                        <span className="text-[10px] text-[var(--accent)] w-3.5 text-center">{step.icon}</span>
                                        <span className={`text-[10px] leading-relaxed ${isDone ? "text-[var(--text-faint)]" : "text-[var(--text-body)]"}`}>{step.label}</span>
                                        {isActive && <span className="absolute right-3 w-1 h-1 rounded-full bg-[var(--accent)] animate-pulse" />}
                                    </div>
                                );
                            })}
                            {liveSections.length > 0 && (
                                <div className="flex items-baseline gap-1.5 px-3 py-2.5 border-t border-[var(--border)]">
                                    <span className="text-lg text-[var(--accent)]" style={{ fontFamily: "Fraunces,serif" }}>{liveSections.length}</span>
                                    <span className="text-[9.5px] text-[var(--text-faint)] tracking-wide font-mono">
                                        {loading ? "sections ready so far" : "sections total"}
                                    </span>
                                </div>
                            )}
                        </div>
                    )}
                </div>

                {/* Left panel (structure / log) */}
                <div className="w-[200px] flex-shrink-0 border-r border-[var(--border)] flex flex-col bg-[var(--bg-surface)] overflow-hidden">
                    <div className="flex border-b border-[var(--border)] flex-shrink-0">
                        {[["structure", "Structure"], ["log", `Log · ${liveLog.length}`]].map(([key, label]) => (
                            <button
                                key={key}
                                onClick={() => setLeftPanel(key)}
                                className={`flex-1 h-9 bg-none border-none cursor-pointer text-[10px] tracking-widest uppercase font-mono transition-colors ${leftPanel === key
                                    ? "text-[var(--accent)] border-b-2 border-[var(--accent)]"
                                    : "text-[var(--text-faint)] border-b-2 border-transparent hover:text-[var(--text-muted)]"
                                    }`}
                            >
                                {label}
                                {key === "log" && loading && (
                                    <span className="inline-block w-1 h-1 rounded-full bg-[var(--accent)] ml-1.5 align-middle animate-pulse" />
                                )}
                            </button>
                        ))}
                    </div>

                    {leftPanel === "structure" && <StructurePane latex={latexSource} />}

                    {leftPanel === "log" && (
                        <div className="overflow-auto flex-1 py-1">
                            {detectedMeta && (
                                <div className="mx-2.5 my-2 bg-[var(--bg-input)] border border-[var(--border)] rounded-md px-3 py-2 text-[10px] leading-7 font-mono">
                                    {[
                                        ["Material", detectedMeta.material],
                                        ["Heat No.", detectedMeta.heat],
                                        ["Sections", (detectedMeta.sections_found || []).length],
                                        ["Chunks", (detectedMeta.total_chunks || 0).toLocaleString()],
                                    ].map(([k, v]) => (
                                        <div key={k} className="flex justify-between">
                                            <span className="text-[var(--text-faint)]">{k}</span>
                                            <span className="text-[var(--accent)]">{v}</span>
                                        </div>
                                    ))}
                                </div>
                            )}
                            {liveLog.map((entry, i) => (
                                <div key={i} className="flex items-center gap-2 px-3 py-1.5 border-b border-[var(--border)] animate-[slideIn_.15s_ease_both]">
                                    <span className={`text-[10px] w-3 flex-shrink-0 ${entry.done ? "text-[var(--text-faint)]" : "text-[var(--accent)]"}`}>{entry.icon}</span>
                                    <span className={`text-[10px] leading-relaxed flex-1 ${entry.done ? "text-[var(--text-faint)]" : "text-[var(--text-body)]"}`}>{entry.label}</span>
                                    {i === liveLog.length - 1 && loading && (
                                        <span className="w-1 h-1 rounded-full bg-[var(--accent)] animate-pulse flex-shrink-0" />
                                    )}
                                </div>
                            ))}
                            <div ref={logEndRef} />
                            {!loading && liveLog.length === 0 && (
                                <div className="px-4 py-6 text-[var(--text-faint)] text-[10px] text-center font-mono">
                                    Generate a report to see live progress
                                </div>
                            )}
                        </div>
                    )}
                </div>

                {/* Main editor area */}
                <div className="flex-1 flex flex-col min-w-0 min-h-0">
                    <div className="flex items-center h-[34px] border-b border-[var(--border)] px-4 bg-[var(--bg-panel)] flex-shrink-0">
                        <span className="text-[10px] text-[var(--text-faint)] font-mono tracking-wide">
                            {latexSource ? "main.tex" : "—"}
                        </span>
                        <div className="ml-auto flex gap-1 items-center">
                            {latexSource && (
                                <span className="text-[10px] text-[var(--text-faint)] font-mono">
                                    {lineCount.toLocaleString()} lines
                                </span>
                            )}
                        </div>
                    </div>

                    <div className="flex-1 flex flex-col min-h-0 bg-[#1E1E1E]">
                        {latexSource ? (
                            editorMode === "highlight"
                                ? <HighlightedView code={latexSource} fontSize={fontSize} />
                                : <EditableEditor value={latexSource} onChange={setLatexSource} fontSize={fontSize} />
                        ) : (
                            <div className="flex-1 flex flex-col items-center justify-center gap-4 bg-[var(--bg-base)]">
                                {loading ? (
                                    <>
                                        <div className="text-[28px] text-[var(--accent)] animate-spin">◈</div>
                                        <div className="text-base text-[var(--text-muted)]" style={{ fontFamily: "Fraunces,serif", fontStyle: "italic" }}>Generating report...</div>
                                        <p className="text-[11px] text-[var(--text-faint)] text-center font-mono">
                                            Switch to <strong className="text-[var(--text-muted)]">Log</strong> in the left panel<br />to watch section-by-section progress.
                                        </p>
                                    </>
                                ) : filename ? (
                                    <>
                                        <div className="text-[28px] text-[var(--text-faint)]">∴</div>
                                        <div className="text-base text-[var(--text-muted)]" style={{ fontFamily: "Fraunces,serif", fontStyle: "italic" }}>Ready to generate</div>
                                        <p className="text-[11px] text-[var(--text-faint)] text-center font-mono">
                                            Sections are auto-discovered from the PDF.<br />
                                            Output is a fully compilable LaTeX document.
                                        </p>
                                        <button className="primary-btn mt-2" onClick={generate}>
                                            <span className="text-[10px]">✦</span> Generate Report
                                        </button>
                                    </>
                                ) : (
                                    <>
                                        <div className="text-[28px] text-[var(--text-faint)]">⬡</div>
                                        <div className="text-base text-[var(--text-muted)]" style={{ fontFamily: "Fraunces,serif", fontStyle: "italic" }}>No document selected</div>
                                        <p className="text-[11px] text-[var(--text-faint)] font-mono">Select a PDF in the chatbot first.</p>
                                        <button className="ghost-btn" onClick={() => navigate("/")}>← Go to Chat</button>
                                    </>
                                )}
                            </div>
                        )}
                    </div>

                    {/* Status bar */}
                    <div className="flex items-center h-[22px] border-t border-[var(--border)] px-3 bg-[var(--bg-panel)] flex-shrink-0 text-[10px] font-mono">
                        <span style={{ color: latexSource ? "var(--accent)" : "var(--text-faint)" }}>{latexSource ? "LaTeX" : "—"}</span>
                        <span className="ml-4 text-[var(--text-faint)]">UTF-8</span>
                        {latexSource && (
                            <>
                                <span className="ml-4 text-[var(--text-faint)]">{lineCount.toLocaleString()} lines</span>
                                <span className="ml-4 text-[var(--text-faint)]">{(charCount / 1024).toFixed(1)} KB</span>
                            </>
                        )}
                        <div className="ml-auto flex gap-3 items-center">
                            {loading && <span className="text-[var(--accent)] text-[10px] animate-pulse">● Generating</span>}
                            {compiling && <span className="text-[var(--teal)] text-[10px] animate-pulse">● Compiling</span>}
                            {!loading && latexSource && <span className="text-[var(--text-faint)]">Ready</span>}
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
}