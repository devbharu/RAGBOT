/**
 * Chatbot.jsx — CMTI Bot v8.2
 * Changes from v8.1:
 *  - Paste cards: MULTIPLE cards supported (array of chips)
 *  - Clicking a paste chip opens a full modal code-viewer (like Claude.ai "Pasted content")
 *  - UserMenu removed from top bar (already in Sidebar)
 *  - Copy button on every message (hover to reveal)
 */

import React, { useState, useRef, useEffect, useCallback } from "react";
import {
    Send, Paperclip, FileText, ChevronDown,
    Upload, X, FileUp, CheckCircle, Loader2,
    ArrowDown, RefreshCw, Clock, FileSearch, Trash2, Sun, Moon, Share2, Copy, Check,
} from "lucide-react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import rehypeKatex from "rehype-katex";
import rehypeRaw from "rehype-raw";
import "katex/dist/katex.min.css";
import { useNavigate } from "react-router-dom";
import { useApp, API } from "../context/AppContext";
import { useTheme } from "../context/ThemeContext";

/* ─── Paste threshold ────────────────────────────────────────── */
const PASTE_CARD_THRESHOLD = 300;

/* ─── helpers ────────────────────────────────────────────────── */
function formatBytes(bytes) {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
function isCodeLike(text) {
    return /[{};=><()[\]]/.test(text.slice(0, 300));
}

/* ─── Copy Button ─────────────────────────────────────────────── */
const CopyButton = ({ text }) => {
    const [copied, setCopied] = useState(false);
    const handleCopy = async (e) => {
        e.stopPropagation();
        try { await navigator.clipboard.writeText(text); setCopied(true); setTimeout(() => setCopied(false), 2000); } catch { }
    };
    return (
        <button onClick={handleCopy} title="Copy"
            className={`flex items-center gap-1 px-2 py-1 rounded-lg text-[10px] font-mono border transition-all cursor-pointer ${copied
                ? "bg-[var(--accent-dim)] border-[var(--accent)]/40 text-[var(--accent)]"
                : "bg-transparent border-[var(--border-mid)] text-[var(--text-faint)] hover:text-[var(--text-muted)] hover:bg-[var(--bg-elevated)]"}`}>
            {copied ? <Check size={10} /> : <Copy size={10} />}
            {copied ? "Copied" : "Copy"}
        </button>
    );
};

/* ─── Paste Content Modal ────────────────────────────────────── */
const PasteModal = ({ card, onClose }) => {
    const lines = card.content.split("\n");
    const bytes = new TextEncoder().encode(card.content).length;

    useEffect(() => {
        const handler = (e) => { if (e.key === "Escape") onClose(); };
        document.addEventListener("keydown", handler);
        return () => document.removeEventListener("keydown", handler);
    }, [onClose]);

    return (
        <div
            className="fixed inset-0 z-[300] flex items-center justify-center bg-black/70 backdrop-blur-sm animate-[fadeIn_0.12s_ease]"
            onClick={onClose}
        >
            <div
                className="relative w-full max-w-2xl mx-4 flex flex-col rounded-2xl overflow-hidden shadow-2xl animate-[fadeSlideUp_0.18s_ease]"
                style={{ background: "var(--bg-panel)", border: "1px solid var(--border-mid)", maxHeight: "80vh" }}
                onClick={e => e.stopPropagation()}
            >
                {/* Header */}
                <div className="flex items-start justify-between px-6 py-4 flex-shrink-0" style={{ borderBottom: "1px solid var(--border)" }}>
                    <div>
                        <h2 className="text-[15px] font-medium text-[var(--text-primary)] m-0" style={{ fontFamily: "'Fraunces', serif", fontStyle: "italic" }}>
                            Pasted content
                        </h2>
                        <div className="flex items-center gap-2 mt-1 text-[11px] text-[var(--text-faint)] font-mono">
                            <span>{formatBytes(bytes)}</span>
                            <span className="w-1 h-1 rounded-full bg-[var(--text-faint)] inline-block" />
                            <span>{lines.length} lines</span>
                            {isCodeLike(card.content) && (
                                <>
                                    <span className="w-1 h-1 rounded-full bg-[var(--text-faint)] inline-block" />
                                    <span className="opacity-60">Formatting may be inconsistent from source</span>
                                </>
                            )}
                        </div>
                    </div>
                    <div className="flex items-center gap-2 flex-shrink-0 ml-4">
                        <CopyButton text={card.content} />
                        <button onClick={onClose}
                            className="p-1.5 rounded-lg bg-transparent border border-[var(--border-mid)] cursor-pointer text-[var(--text-faint)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-elevated)] transition-all">
                            <X size={14} />
                        </button>
                    </div>
                </div>

                {/* Code viewer with line numbers */}
                <div className="flex-1 overflow-auto" style={{ background: "var(--bg-base)" }}>
                    <div className="px-4 py-4 font-mono text-[12.5px] leading-[1.75]">
                        {lines.map((line, i) => (
                            <div key={i} className="flex gap-4 group hover:bg-[var(--accent-dim)]/40 rounded px-2 -mx-2 transition-colors">
                                <span className="select-none text-[var(--text-faint)] w-8 text-right flex-shrink-0 leading-[1.75] text-[11px]">
                                    {i + 1}
                                </span>
                                <span className="flex-1 text-[var(--text-body)] break-all whitespace-pre-wrap">{line || "\u00A0"}</span>
                            </div>
                        ))}
                    </div>
                </div>
            </div>
        </div>
    );
};

/* ─── Paste Chip (compact pill shown in input) ───────────────── */
const PasteChip = ({ card, onRemove, onClick }) => {
    const lines = card.content.split("\n").length;
    const bytes = new TextEncoder().encode(card.content).length;
    return (
        <div
            className="inline-flex items-center gap-1.5 mr-1.5 mb-1.5 pl-2.5 pr-1 py-1 rounded-xl border border-[var(--border-mid)] bg-[var(--bg-elevated)] cursor-pointer transition-all hover:border-[var(--accent)]/40 hover:bg-[var(--accent-dim)] animate-[fadeSlideUp_0.15s_ease]"
            onClick={onClick}
        >
            <FileText size={11} className="text-[var(--accent)] flex-shrink-0" />
            <span className="text-[11px] font-mono text-[var(--text-primary)]">
                {isCodeLike(card.content) ? "Code" : "Text"}
            </span>
            <span className="text-[10px] font-mono text-[var(--text-faint)]">
                {lines}L · {formatBytes(bytes)}
            </span>
            <button
                onClick={e => { e.stopPropagation(); onRemove(card.id); }}
                className="ml-0.5 p-0.5 rounded-md bg-transparent border-none cursor-pointer text-[var(--text-faint)] hover:text-red-400 transition-colors"
            >
                <X size={10} />
            </button>
        </div>
    );
};

/* ─── Upload Zone ─────────────────────────────────────────────── */
const UploadZone = ({ onUpload, uploading, uploadProgress }) => {
    const [dragging, setDragging] = useState(false);
    const inputRef = useRef(null);
    const handleDrop = useCallback((e) => {
        e.preventDefault(); setDragging(false);
        const file = e.dataTransfer.files[0]; if (file) onUpload(file);
    }, [onUpload]);
    return (
        <div
            onDrop={handleDrop}
            onDragOver={e => { e.preventDefault(); setDragging(true); }}
            onDragLeave={() => setDragging(false)}
            onClick={() => !uploading && inputRef.current?.click()}
            className={`relative flex flex-col items-center justify-center gap-3 rounded-xl p-8 transition-all duration-200 cursor-pointer border border-dashed ${dragging ? "border-[var(--accent)] bg-[var(--accent-dim)]" : "border-[var(--border-mid)] bg-[var(--bg-base)]"} ${uploading ? "opacity-70 pointer-events-none" : ""}`}
        >
            <input ref={inputRef} type="file" accept=".pdf,.txt" onChange={e => { const f = e.target.files[0]; if (f) onUpload(f); e.target.value = ""; }} className="hidden" />
            <div className={`w-11 h-11 rounded-xl flex items-center justify-center border transition-all ${dragging ? "bg-[var(--accent-dim)] border-[var(--accent)]" : "bg-[var(--bg-elevated)] border-[var(--border-mid)]"}`}>
                {uploading ? <Loader2 size={18} className="text-[var(--accent)] animate-spin" /> : <FileUp size={18} className={dragging ? "text-[var(--accent)]" : "text-[var(--text-faint)]"} />}
            </div>
            <div className="text-center">
                <p className="text-sm text-[var(--text-primary)] font-mono m-0">{uploading ? uploadProgress : dragging ? "Drop to upload" : "Drop file here"}</p>
                <p className="text-xs text-[var(--text-faint)] mt-1 font-mono">{uploading ? "Processing…" : "click to browse · PDF & TXT"}</p>
            </div>
        </div>
    );
};

/* ─── Upload Modal ───────────────────────────────────────────── */
const UploadPanel = ({ onClose }) => {
    const { handleUploadFile, uploading, uploadProgress, files, selectedFile, setSelectedFile, handleReindex } = useApp();
    return (
        <div className="fixed inset-0 z-[200] flex items-center justify-center bg-black/60 backdrop-blur-sm" onClick={() => !uploading && onClose()}>
            <div className="relative w-full max-w-md mx-4 bg-[var(--bg-panel)] border border-[var(--border-mid)] rounded-2xl p-6 flex flex-col gap-5 shadow-2xl" onClick={e => e.stopPropagation()}>
                <div className="flex items-start justify-between">
                    <div>
                        <h2 className="text-sm font-medium text-[var(--text-primary)] m-0" style={{ fontFamily: "'Fraunces', serif", fontStyle: "italic" }}>Upload Document</h2>
                        <p className="text-[10px] text-[var(--text-faint)] mt-1 tracking-widest uppercase font-mono">PDF or TXT · indexed automatically</p>
                    </div>
                    {!uploading && (<button onClick={onClose} className="p-1.5 rounded-lg bg-transparent border border-[var(--border-mid)] cursor-pointer text-[var(--text-muted)] flex items-center justify-center transition-all hover:bg-[var(--bg-elevated)] hover:text-[var(--text-primary)]"><X size={13} /></button>)}
                </div>
                <UploadZone onUpload={handleUploadFile} uploading={uploading} uploadProgress={uploadProgress} />
                {!uploading && files.length > 0 && (
                    <div>
                        <p className="text-[10px] text-[var(--text-faint)] tracking-widest uppercase mb-2 font-mono">Indexed documents</p>
                        <div className="flex flex-col gap-0.5 max-h-48 overflow-y-auto">
                            {files.map(f => (
                                <div key={f.name} className={`flex items-center gap-2 px-2.5 py-1.5 rounded-lg border transition-all ${selectedFile === f.name ? "bg-[var(--accent-dim)] border-[var(--accent)]/30" : "border-transparent"}`}>
                                    <button onClick={() => { setSelectedFile(f.name); onClose(); }} className={`flex items-center gap-2 flex-1 text-left bg-transparent border-none cursor-pointer text-xs font-mono ${selectedFile === f.name ? "text-[var(--accent)]" : "text-[var(--text-muted)]"}`}>
                                        <FileText size={11} className="flex-shrink-0" />
                                        <span className="flex-1 overflow-hidden text-ellipsis whitespace-nowrap">{f.name}</span>
                                        {f.status === "indexing" && <span className="text-[10px] text-[var(--accent)]/60 flex items-center gap-1"><Clock size={9} />indexing</span>}
                                        {f.status === "ready" && selectedFile === f.name && <CheckCircle size={11} className="text-[var(--accent)]" />}
                                    </button>
                                    <button onClick={e => { e.stopPropagation(); handleReindex(f.name); }} title="Re-index" className="p-1 rounded bg-transparent border-none cursor-pointer text-[var(--text-faint)] hover:text-[var(--text-muted)] hover:bg-[var(--bg-elevated)] transition-all"><RefreshCw size={10} /></button>
                                </div>
                            ))}
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
};

/* ─── Document Viewer Panel ───────────────────────────────────── */
const PdfViewerPanel = ({ filename, onClose }) => {
    const { getFileUrl } = useApp();
    const [fileError, setFileError] = useState(false);
    const [loading, setLoading] = useState(true);
    const isPdf = filename?.toLowerCase().endsWith(".pdf");
    const isTxt = filename?.toLowerCase().endsWith(".txt");
    const isSupported = isPdf || isTxt;
    const fileUrl = isSupported ? getFileUrl(filename) : null;
    const fileType = isPdf ? "PDF" : isTxt ? "Text" : "Document";
    return (
        <div className="flex flex-col h-full bg-[var(--bg-base)] overflow-hidden">
            <div className="flex items-center justify-between px-4 py-3 flex-shrink-0 border-b border-[var(--border-mid)]" style={{ backgroundColor: "var(--bg-panel)" }}>
                <div className="flex items-center gap-2.5 flex-1 min-w-0">
                    <div className="w-8 h-8 rounded-lg bg-[var(--accent-dim)] flex items-center justify-center flex-shrink-0"><FileSearch size={14} className="text-[var(--accent)]" /></div>
                    <div className="flex-1 min-w-0">
                        <p className="text-[9px] text-[var(--text-faint)] font-mono tracking-widest uppercase mb-0.5">Document</p>
                        <p className="text-xs text-[var(--text-primary)] font-medium truncate" title={filename}>{filename || "No file"}</p>
                    </div>
                </div>
                <div className="flex items-center gap-1.5 flex-shrink-0">
                    {fileError && fileUrl && (<a href={fileUrl} target="_blank" rel="noopener noreferrer" className="p-1.5 rounded-md bg-[var(--accent-dim)] border border-[var(--border)] cursor-pointer text-[var(--accent)] hover:bg-[var(--accent)] hover:text-white transition-all"><Share2 size={13} /></a>)}
                    {fileUrl && (<a href={fileUrl} download className="p-1.5 rounded-md bg-transparent border border-[var(--border)] cursor-pointer text-[var(--text-muted)] hover:text-[var(--accent)] transition-all"><Upload size={13} /></a>)}
                    <button onClick={onClose} className="p-1.5 rounded-md bg-transparent border border-[var(--border)] cursor-pointer text-[var(--text-faint)] hover:text-[var(--text-primary)] transition-all"><X size={13} /></button>
                </div>
            </div>
            <div className="flex-1 overflow-hidden relative bg-white flex flex-col">
                {loading && fileUrl && !fileError && (<div className="absolute inset-0 flex flex-col items-center justify-center bg-white z-20"><Loader2 size={28} className="text-[var(--accent)] animate-spin mb-2" /><p className="text-sm text-[var(--text-faint)] font-mono">Loading {fileType}…</p></div>)}
                {fileUrl && !fileError && (<iframe src={fileUrl} title="File Viewer" className="w-full h-full border-none flex-1 bg-white" onLoad={() => setLoading(false)} onError={() => { setLoading(false); setFileError(true); }} allow="fullscreen" />)}
                {(!fileUrl || fileError) && (
                    <div className="flex-1 flex flex-col items-center justify-center gap-4 px-8 py-12">
                        <div className="w-16 h-16 rounded-2xl bg-[var(--bg-panel)] border border-[var(--border-mid)] flex items-center justify-center"><FileSearch size={32} className="text-[var(--accent)] opacity-50" /></div>
                        <div className="text-center">
                            <h3 className="text-sm font-semibold text-[var(--text-primary)] mb-1">{!filename ? "No Document Selected" : !isSupported ? "File Not Supported" : "Unable to Load"}</h3>
                            <p className="text-xs text-[var(--text-faint)] leading-relaxed">{fileError ? "Couldn't load this file." : !filename ? "Select a PDF or TXT to preview." : "Only PDF and TXT files can be previewed."}</p>
                        </div>
                        {fileError && fileUrl && (<a href={fileUrl} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-2 px-4 py-2 bg-[var(--accent)] text-[#09090c] text-xs font-semibold rounded-lg hover:opacity-90 transition-all"><Share2 size={12} /> Open in New Tab</a>)}
                    </div>
                )}
            </div>
        </div>
    );
};

/* ─── LaTeX normaliser ───────────────────────────────────────── */
function normaliseContent(text) {
    text = text.replace(/\\\[([\s\S]*?)\\\]/g, (_, i) => `\n$$${i}$$\n`);
    text = text.replace(/\\\(([\s\S]*?)\\\)/g, (_, i) => `$${i}$`);
    text = text.replace(/(\$[^$\n]+?\$)\s*\1/g, "$1");
    text = text.replace(/<br\s*\/?>/gi, " · ");
    return text;
}

/* ─── Markdown renderer ──────────────────────────────────────── */
const MarkdownMessage = ({ content }) => (
    <ReactMarkdown
        remarkPlugins={[remarkGfm, remarkMath]}
        rehypePlugins={[rehypeRaw, [rehypeKatex, { strict: false, throwOnError: false }]]}
        components={{
            div: ({ className, children, ...props }) => { if (className?.includes("math-display")) return <div className="my-3 px-4 py-3 bg-[var(--bg-base)] border border-[var(--border-mid)] rounded-lg overflow-x-auto text-center" {...props}>{children}</div>; return <div className={className} {...props}>{children}</div>; },
            span: ({ className, children, ...props }) => { if (className?.includes("math-inline")) return <span className="px-1.5 py-0.5 rounded bg-[var(--accent-dim)] text-[var(--accent)] font-mono text-[0.875em]" {...props}>{children}</span>; return <span className={className} {...props}>{children}</span>; },
            table: ({ ...props }) => <div className="overflow-x-auto my-3 rounded-lg border border-[var(--border-mid)] w-full"><table className="border-collapse text-[12.5px] w-full font-mono" style={{ tableLayout: "fixed", wordBreak: "break-word" }} {...props} /></div>,
            thead: ({ ...props }) => <thead className="bg-[var(--bg-elevated)]" {...props} />,
            th: ({ ...props }) => <th className="border-none border-b border-[var(--border-mid)] px-3.5 py-2.5 text-left font-semibold text-[var(--text-primary)] text-[10.5px] tracking-widest uppercase" {...props} />,
            td: ({ ...props }) => <td className="border-none border-b border-[var(--border)] px-3.5 py-2 text-[var(--text-body)] text-[12.5px] leading-relaxed align-top" style={{ wordBreak: "break-word" }} {...props} />,
            tr: ({ ...props }) => <tr className="transition-colors hover:bg-[var(--accent-dim)]" {...props} />,
            tbody: ({ ...props }) => <tbody {...props} />,
            code: ({ inline, children, ...props }) => inline ? <code className="bg-[var(--accent-dim)] px-1.5 py-0.5 rounded text-[var(--accent)] text-[0.84em] font-mono" {...props}>{children}</code> : <pre className="bg-[var(--code-bg)] border border-[var(--border)] rounded-lg px-4 py-3.5 overflow-x-auto my-3"><code className="text-[#d4d4d0] text-[0.8em] font-mono leading-7" {...props}>{children}</code></pre>,
            h1: ({ ...props }) => <h1 className="text-lg font-light text-[var(--text-primary)] mt-4 mb-1" style={{ fontFamily: "'Fraunces', serif", fontStyle: "italic" }} {...props} />,
            h2: ({ ...props }) => <h2 className="text-sm font-normal text-[var(--text-primary)] mt-3 mb-1" style={{ fontFamily: "'Fraunces', serif", fontStyle: "italic" }} {...props} />,
            h3: ({ ...props }) => <h3 className="text-[12.5px] font-semibold text-[var(--text-body)] mt-3 mb-1 font-mono tracking-widest uppercase" {...props} />,
            ul: ({ ...props }) => <ul className="pl-4 my-2 flex flex-col gap-1" {...props} />,
            ol: ({ ...props }) => <ol className="pl-4 my-2 flex flex-col gap-1" {...props} />,
            li: ({ ...props }) => <li className="text-[var(--text-body)] leading-7 text-[13.5px]" {...props} />,
            p: ({ ...props }) => <p className="mb-2.5 text-[var(--text-body)] leading-relaxed text-[13.5px]" {...props} />,
            strong: ({ ...props }) => <strong className="font-bold text-[var(--text-primary)]" {...props} />,
            em: ({ ...props }) => <em className="italic text-[var(--text-muted)]" style={{ fontFamily: "'Fraunces', serif" }} {...props} />,
            blockquote: ({ ...props }) => <blockquote className="border-l-2 border-[var(--accent)] ml-0 text-[var(--text-muted)] italic bg-[var(--accent-dim)] rounded-r-lg px-3.5 py-2.5 my-3" {...props} />,
            a: ({ ...props }) => <a className="text-[var(--accent)] underline underline-offset-2" target="_blank" rel="noopener noreferrer" {...props} />,
            hr: ({ ...props }) => <hr className="border-none border-t border-[var(--border)] my-4" {...props} />,
        }}
    >{normaliseContent(content)}</ReactMarkdown>
);

/* ─── Think Block ────────────────────────────────────────────── */
const ThinkBlock = ({ thinking, done }) => {
    const [open, setOpen] = useState(false);
    const secs = Math.max(1, Math.round(thinking.length / 200));
    return (
        <div className="mb-2.5">
            <button onClick={() => setOpen(o => !o)} className={`flex items-center gap-1.5 bg-transparent border-none cursor-pointer p-0 text-[11px] font-mono tracking-wide ${done ? "text-[var(--text-faint)]" : "text-[var(--accent)]/70"}`}>
                {!done ? <Loader2 size={11} className="animate-spin text-[var(--accent)]" /> : <span className="text-[10px]">{open ? "▲" : "▼"}</span>}
                {done ? `Thought for ${secs}s` : "Thinking…"}
            </button>
            {open && done && <div className="mt-1.5 px-3.5 py-2.5 bg-[var(--bg-base)] border border-[var(--border)] rounded-lg text-[11.5px] text-[var(--text-muted)] font-mono leading-7 whitespace-pre-wrap">{thinking}</div>}
        </div>
    );
};

/* ─── Typing dots ────────────────────────────────────────────── */
const TypingDots = () => (
    <div className="flex gap-1.5 items-center py-1">
        {[0, 140, 280].map((delay, i) => (<span key={i} className="w-1.5 h-1.5 rounded-full bg-[var(--text-faint)] block animate-[bounce_1.2s_ease-in-out_infinite]" style={{ animationDelay: `${delay}ms` }} />))}
    </div>
);

/* ─── FileOption ─────────────────────────────────────────────── */
const FileOption = ({ name, status, selected, onSelect, onDelete }) => (
    <div className={`flex items-center gap-0.5 w-full transition-colors rounded-md ${selected ? "bg-[var(--accent-dim)]" : "hover:bg-[var(--bg-elevated)]"}`}>
        <button onClick={onSelect} className={`flex-1 text-left px-3 py-2 text-xs flex items-center gap-2 bg-transparent border-none cursor-pointer font-mono tracking-wide overflow-hidden ${selected ? "text-[var(--accent)]" : "text-[var(--text-muted)]"}`}>
            <FileText size={11} className="flex-shrink-0" />
            <span className="flex-1 overflow-hidden text-ellipsis whitespace-nowrap">{name}</span>
            {status === "indexing" && <Clock size={10} className="text-[var(--accent)]/60 flex-shrink-0" />}
            {selected && status !== "indexing" && <CheckCircle size={11} className="flex-shrink-0 text-[var(--accent)]" />}
        </button>
        <button onClick={e => { e.stopPropagation(); onDelete(name); }} title="Delete" className="px-2.5 py-2 bg-transparent border-none cursor-pointer text-[var(--text-faint)] hover:text-red-400 transition-colors"><Trash2 size={11} /></button>
    </div>
);

/* ─── Suggested Questions ────────────────────────────────────── */
const SuggestedQuestions = ({ file, onSelect }) => {
    if (!file) return null;
    const prompts = ["Summarize this document", "What are the key findings?", "List all tables and figures", "What are the main conclusions?"];
    return (
        <div className="flex flex-wrap gap-2 justify-center max-w-lg">
            {prompts.map(p => (
                <button key={p} onClick={() => onSelect(p)} className="px-4 py-2 rounded-xl bg-[var(--bg-elevated)] border border-[var(--border-mid)] text-[var(--text-body)] text-xs cursor-pointer font-mono tracking-wide transition-all hover:border-[var(--accent)]/40 hover:text-[var(--accent)] hover:bg-[var(--accent-dim)]">{p}</button>
            ))}
        </div>
    );
};

/* ─── Theme Toggle ───────────────────────────────────────────── */
const ThemeToggle = () => {
    const { isDark, toggleTheme } = useTheme();
    return (
        <button onClick={toggleTheme} title={isDark ? "Light mode" : "Dark mode"} className="p-2 rounded-lg bg-transparent border border-[var(--border-mid)] text-[var(--text-muted)] cursor-pointer transition-all hover:bg-[var(--bg-elevated)] hover:text-[var(--text-body)]">
            {isDark ? <Sun size={14} /> : <Moon size={14} />}
        </button>
    );
};

/* ─── Main Chatbot ───────────────────────────────────────────── */
const Chatbot = () => {
    const navigate = useNavigate();
    const { files, selectedFile, setSelectedFile, uploading, uploadProgress, handleUploadFile, handleDeleteFile, handleReindex, messages, setMessages, addChatToHistory, activeChat } = useApp();

    const [inputValue, setInputValue] = useState("");
    // Multiple paste cards: [{ id: number, content: string }]
    const [pasteCards, setPasteCards] = useState([]);
    // Which card's modal is open (by id)
    const [modalCardId, setModalCardId] = useState(null);

    const [isTyping, setIsTyping] = useState(false);
    const [activePanel, setActivePanel] = useState(null);
    const [showDropdown, setShowDropdown] = useState(false);
    const [showUploadPanel, setShowUploadPanel] = useState(false);
    const [showScrollBtn, setShowScrollBtn] = useState(false);
    const [userScrolled, setUserScrolled] = useState(false);

    const messagesEndRef = useRef(null);
    const scrollContainerRef = useRef(null);
    const textareaRef = useRef(null);
    const isAtBottomRef = useRef(true);

    const scrollToBottom = useCallback((behavior = "smooth") => { messagesEndRef.current?.scrollIntoView({ behavior }); }, []);
    const checkIsAtBottom = useCallback(() => { const el = scrollContainerRef.current; if (!el) return true; return el.scrollHeight - el.scrollTop - el.clientHeight < 80; }, []);
    const handleScroll = useCallback(() => {
        const atBottom = checkIsAtBottom(); isAtBottomRef.current = atBottom;
        setShowScrollBtn(!atBottom);
        if (atBottom) setUserScrolled(false); else setUserScrolled(true);
    }, [checkIsAtBottom]);

    useEffect(() => { if (!userScrolled) scrollToBottom("smooth"); }, [messages, userScrolled, scrollToBottom]);
    useEffect(() => { if (isTyping && isAtBottomRef.current) scrollToBottom("auto"); }, [messages, isTyping, scrollToBottom]);
    useEffect(() => {
        if (textareaRef.current) {
            textareaRef.current.style.height = "auto";
            textareaRef.current.style.height = `${Math.min(textareaRef.current.scrollHeight, 200)}px`;
        }
    }, [inputValue]);
    useEffect(() => {
        if (messages.length > 1 && !activeChat) {
            const firstUserMsg = messages.find(msg => msg.type === "user");
            if (firstUserMsg) addChatToHistory(firstUserMsg.content.substring(0, 50));
        }
    }, [messages.length, activeChat, messages, addChatToHistory]);

    /* ── Paste — intercept large pastes, push to cards array ── */
    const handlePaste = useCallback((e) => {
        const pasted = e.clipboardData?.getData("text") || "";
        if (pasted.length >= PASTE_CARD_THRESHOLD) {
            e.preventDefault();
            setPasteCards(prev => [...prev, { id: Date.now(), content: pasted }]);
        }
    }, []);

    const removeCard = useCallback((id) => {
        setPasteCards(prev => prev.filter(c => c.id !== id));
        setModalCardId(prev => (prev === id ? null : prev));
    }, []);

    const openModal = useCallback((id) => setModalCardId(id), []);
    const closeModal = useCallback(() => setModalCardId(null), []);

    /* ── Build combined prompt ── */
    const buildPrompt = () => {
        const parts = [];
        if (inputValue.trim()) parts.push(inputValue.trim());
        pasteCards.forEach(c => parts.push(c.content));
        return parts.join("\n\n");
    };

    const canSend = (inputValue.trim() || pasteCards.length > 0) && selectedFile && !uploading;

    const handleSend = async (overrideText) => {
        const text = overrideText || buildPrompt();
        if (!text.trim()) return;
        if (!selectedFile) {
            setMessages(prev => [...prev, { id: Date.now(), type: "bot", content: "Please upload or select a file first.", timestamp: new Date() }]);
            return;
        }
        const userMsg = { id: Date.now(), type: "user", content: text, timestamp: new Date() };
        setMessages(prev => [...prev, userMsg]);
        setInputValue(""); setPasteCards([]); setModalCardId(null);
        setIsTyping(true); setUserScrolled(false); isAtBottomRef.current = true;
        const botId = Date.now() + 1;
        setMessages(prev => [...prev, { id: botId, type: "bot", content: "", timestamp: new Date(), thinking: "", thinkDone: false }]);

        try {
            const response = await fetch(`${API}/generate`, {
                method: "POST", headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ prompt: userMsg.content, filename: selectedFile, temperature: 0.4, max_output_tokens: 1024, top_p: 0.9 })
            });
            const contentType = response.headers.get("content-type") || "";
            if (contentType.includes("application/json")) {
                const data = await response.json();
                setMessages(prev => prev.map(msg => msg.id === botId ? { ...msg, content: data.response || "" } : msg));
                return;
            }
            const tokenQueue = [];
            const DRIP_INTERVAL = 18, CHARS_PER_TICK = 2;
            const drip = setInterval(() => {
                if (!tokenQueue.length) return;
                const chunk = tokenQueue.splice(0, CHARS_PER_TICK).join("");
                setMessages(prev => prev.map(msg => msg.id === botId ? { ...msg, content: msg.content + chunk } : msg));
                if (isAtBottomRef.current) scrollToBottom("auto");
            }, DRIP_INTERVAL);
            const reader = response.body.getReader(), decoder = new TextDecoder();
            let buffer = "";
            while (true) {
                const { done, value } = await reader.read(); if (done) break;
                buffer += decoder.decode(value, { stream: true });
                const lines = buffer.split("\n"); buffer = lines.pop();
                for (const line of lines) {
                    if (!line.startsWith("data: ")) continue;
                    const data = line.slice(6).trim(); if (data === "[DONE]") break;
                    try {
                        const json = JSON.parse(data);
                        if (json.images) continue;
                        if (json.think_token) { setMessages(prev => prev.map(msg => msg.id === botId ? { ...msg, thinking: (msg.thinking || "") + json.think_token } : msg)); continue; }
                        if (json.think_end) { setMessages(prev => prev.map(msg => msg.id === botId ? { ...msg, thinkDone: true } : msg)); continue; }
                        const token = json.token || "";
                        if (token) tokenQueue.push(...token.split(""));
                    } catch { }
                }
            }
            await new Promise(resolve => {
                const drain = setInterval(() => {
                    if (!tokenQueue.length) { clearInterval(drain); resolve(); return; }
                    const chunk = tokenQueue.splice(0, CHARS_PER_TICK).join("");
                    setMessages(prev => prev.map(msg => msg.id === botId ? { ...msg, content: msg.content + chunk } : msg));
                    if (isAtBottomRef.current) scrollToBottom("auto");
                }, DRIP_INTERVAL);
            });
            clearInterval(drip);
        } catch (error) {
            setMessages(prev => prev.map(msg => msg.id === botId ? { ...msg, content: `Error: ${error.message}` } : msg));
        } finally { setIsTyping(false); }
    };

    const handleKeyDown = (e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); handleSend(); } };
    const togglePanel = (panel) => setActivePanel(prev => prev === panel ? null : panel);
    const isEmpty = files.length === 0 && messages.length <= 1;
    const hasFileButEmpty = files.length > 0 && messages.length <= 1;
    const panelOpen = activePanel !== null;
    const modalCard = pasteCards.find(c => c.id === modalCardId);

    return (
        <>
            <link rel="preconnect" href="https://fonts.googleapis.com" />
            <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="" />
            <link href="https://fonts.googleapis.com/css2?family=Fraunces:ital,opsz,wght@0,9..144,300;0,9..144,500;1,9..144,300&family=DM+Mono:wght@300;400;500&display=swap" rel="stylesheet" />
            <style>{`
                @keyframes fadeSlideUp { from{opacity:0;transform:translateY(8px)} to{opacity:1;transform:translateY(0)} }
                @keyframes fadeIn { from{opacity:0} to{opacity:1} }
                @keyframes bounce { 0%,80%,100%{transform:translateY(0);opacity:.35} 40%{transform:translateY(-5px);opacity:1} }
                .cb-msg-bot { animation: fadeSlideUp 0.2s ease forwards; }
                .cb-msg-user { animation: fadeSlideUp 0.15s ease forwards; }
                ::-webkit-scrollbar { width: 4px; height: 4px; }
                ::-webkit-scrollbar-track { background: transparent; }
                ::-webkit-scrollbar-thumb { background: var(--scrollbar); border-radius: 99px; }
                .chat-input-focus:focus-within { border-color: var(--accent) !important; box-shadow: 0 0 0 3px var(--accent-dim); }
                .msg-copy-btn { opacity: 0; transition: opacity 0.15s ease; }
                .msg-row:hover .msg-copy-btn { opacity: 1; }
            `}</style>

            <div className="relative flex flex-col h-screen overflow-hidden" style={{ background: "var(--bg-surface)", color: "var(--text-body)", fontFamily: "'DM Mono', monospace" }}>

                {showUploadPanel && <UploadPanel onClose={() => setShowUploadPanel(false)} />}
                {/* Paste preview modal */}
                {modalCard && <PasteModal card={modalCard} onClose={closeModal} />}

                {/* ── Top Bar — UserMenu removed (lives in Sidebar) ── */}
                <header className="flex-shrink-0 flex items-center justify-between px-5 h-[52px]   sticky top-0 z-[100]" style={{ backgroundColor: "var(--bg-surface)" }}>
                    <div className="flex items-center gap-2.5">
                        <div className="w-7 h-7 rounded-lg bg-[var(--accent-dim)] border border-[var(--accent)]/25 flex items-center justify-center">
                            <span className="text-[var(--accent)] text-sm leading-none">◈</span>
                        </div>
                        <span className="text-[13px] font-medium text-[var(--text-primary)]" style={{ fontFamily: "'Fraunces', serif" }}>CMTI Bot</span>
                        <span className="hidden sm:block text-[9px] text-[var(--text-faint)] tracking-widest uppercase font-mono border border-[var(--border-mid)] rounded px-1.5 py-0.5">Document Intelligence</span>
                    </div>

                    <div className="flex items-center gap-2">
                        <div className="relative">
                            {showDropdown && <div className="fixed inset-0 z-[1]" onClick={() => setShowDropdown(false)} />}
                            <button onClick={() => setShowDropdown(p => !p)} className={`relative z-[3] flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[11.5px] font-mono max-w-[200px] transition-all border ${showDropdown ? "bg-[var(--bg-elevated)] border-[var(--border)]" : "bg-transparent border-[var(--border-mid)] hover:bg-[var(--bg-elevated)]"} text-[var(--text-body)]`}>
                                <span className="w-1.5 h-1.5 rounded-full bg-[var(--accent)] flex-shrink-0" />
                                <span className="overflow-hidden text-ellipsis whitespace-nowrap flex-1 max-w-[130px]">{selectedFile || "No file"}</span>
                                {files.find(f => f.name === selectedFile)?.status === "indexing" && <Clock size={9} className="text-[var(--accent)]/60 flex-shrink-0" />}
                                <ChevronDown size={10} className={`text-[var(--text-muted)] flex-shrink-0 transition-transform ${showDropdown ? "rotate-180" : ""}`} />
                            </button>
                            {showDropdown && (
                                <div className="absolute right-0 top-[calc(100%+6px)] w-72 bg-[var(--bg-panel)] border border-[var(--border-mid)] rounded-xl shadow-2xl z-[2] overflow-hidden animate-[fadeIn_0.12s_ease] p-1">
                                    {files.length === 0
                                        ? <p className="text-[var(--text-faint)] text-xs px-3 py-3 font-mono">No files indexed yet</p>
                                        : files.map(f => <FileOption key={f.name} name={f.name} status={f.status} selected={selectedFile === f.name} onSelect={() => { setSelectedFile(f.name); setShowDropdown(false); }} onDelete={handleDeleteFile} />)}
                                </div>
                            )}
                        </div>

                        <button onClick={() => setShowUploadPanel(true)} disabled={uploading} className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[11.5px] font-mono transition-all border ${uploading ? "opacity-60 cursor-wait border-[var(--border-mid)] text-[var(--text-faint)]" : "bg-[var(--accent-dim)] border-[var(--accent)]/30 text-[var(--accent)] hover:bg-[var(--accent)]/18 cursor-pointer"}`}>
                            {uploading ? <Loader2 size={12} className="animate-spin" /> : <Upload size={12} />}
                            <span className="hidden sm:inline">{uploading ? "Indexing…" : "Upload"}</span>
                        </button>

                        {selectedFile && (
                            <button onClick={() => togglePanel("pdf")} className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[11.5px] font-mono transition-all border cursor-pointer ${activePanel === "pdf" ? "bg-[var(--accent-dim)] border-[var(--accent)]/35 text-[var(--accent)]" : "bg-transparent border-[var(--border-mid)] text-[var(--text-muted)] hover:bg-[var(--bg-elevated)]"}`}>
                                <FileSearch size={12} /><span className="hidden sm:inline">View</span>
                            </button>
                        )}

                        {selectedFile && (
                            <button onClick={() => navigate("/report")} className="hidden sm:flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[11.5px] font-mono border border-[var(--border-mid)] text-[var(--text-muted)] hover:bg-[var(--bg-elevated)] cursor-pointer transition-all">
                                <FileText size={12} />Report
                            </button>
                        )}

                        <ThemeToggle />
                        {/* UserMenu removed — already in Sidebar */}
                    </div>
                </header>

                {/* ── Main area ── */}
                <div className="flex-1 flex overflow-hidden">
                    <div className={`flex flex-col overflow-hidden transition-all duration-300 ease-[cubic-bezier(0.4,0,0.2,1)] ${panelOpen ? "flex-[0_0_52%] border-r border-[var(--border)]" : "flex-1"}`}>

                        {(isEmpty || hasFileButEmpty) && (
                            <div className="flex-1 flex flex-col items-center justify-center gap-8 px-6 animate-[fadeSlideUp_0.3s_ease]">
                                <div>
                                    <div className="w-12 h-12 rounded-2xl bg-[var(--accent-dim)] border border-[var(--accent)]/20 flex items-center justify-center mx-auto mb-4">
                                        <span className="text-[22px] text-[var(--accent)]">◈</span>
                                    </div>
                                    <div className="text-center">
                                        <p className="text-xl font-light text-[var(--text-primary)] m-0" style={{ fontFamily: "'Fraunces', serif", fontStyle: "italic" }}>
                                            {isEmpty ? "No documents loaded" : "Ready to answer"}
                                        </p>
                                        <p className="text-sm text-[var(--text-muted)] mt-2 font-mono">
                                            {isEmpty ? "Upload a PDF or TXT file to get started" : `Querying · ${selectedFile}`}
                                        </p>
                                    </div>
                                </div>
                                {isEmpty
                                    ? <button onClick={() => setShowUploadPanel(true)} className="flex items-center gap-2 bg-[var(--accent)] text-[#09090c] px-5 py-2.5 rounded-xl text-[12.5px] font-semibold border-none cursor-pointer font-mono tracking-wide transition-all hover:opacity-90"><Upload size={14} />Upload a document</button>
                                    : <SuggestedQuestions file={selectedFile} onSelect={t => handleSend(t)} />
                                }
                            </div>
                        )}

                        {!isEmpty && !hasFileButEmpty && (
                            <div ref={scrollContainerRef} onScroll={handleScroll} className="flex-1 overflow-y-auto px-4 pt-8 pb-4 flex flex-col">
                                <div className="max-w-[720px] w-full mx-auto flex flex-col gap-7">
                                    {messages.map((msg, idx) => (
                                        <div key={msg.id}
                                            className={`msg-row flex ${msg.type === "user" ? "justify-end cb-msg-user" : "justify-start cb-msg-bot"}`}
                                            style={{ animationDelay: `${Math.min(idx * 0.03, 0.18)}s`, animationFillMode: "both" }}>
                                            {msg.type === "user"
                                                ? (
                                                    <div className="flex flex-col items-end gap-1.5 max-w-[75%]">
                                                        <div className="bg-[var(--user-bubble)] border border-[var(--border-mid)] text-[var(--text-primary)] px-4 py-3 rounded-[18px_18px_4px_18px] text-[14px] leading-[1.7] font-mono whitespace-pre-wrap break-words">
                                                            {msg.content}
                                                        </div>
                                                        <div className="msg-copy-btn"><CopyButton text={msg.content} /></div>
                                                    </div>
                                                )
                                                : (
                                                    <div className="flex gap-3 max-w-full items-start w-full">
                                                        <div className="w-7 h-7 rounded-lg flex-shrink-0 bg-[var(--accent-dim)] border border-[var(--accent)]/25 flex items-center justify-center mt-1">
                                                            <span className="text-[var(--accent)] text-xs">◈</span>
                                                        </div>
                                                        <div className="flex-1 min-w-0 overflow-x-hidden">
                                                            {msg.thinking && <ThinkBlock thinking={msg.thinking} done={msg.thinkDone} />}
                                                            {msg.content ? <MarkdownMessage content={msg.content} /> : isTyping && idx === messages.length - 1 ? <TypingDots /> : null}
                                                            {msg.content && <div className="msg-copy-btn mt-1"><CopyButton text={msg.content} /></div>}
                                                        </div>
                                                    </div>
                                                )}
                                        </div>
                                    ))}
                                    <div ref={messagesEndRef} className="h-px" />
                                </div>

                                {showScrollBtn && (
                                    <div className="sticky bottom-3 flex justify-center">
                                        <button onClick={() => { setUserScrolled(false); scrollToBottom("smooth"); }} className="flex items-center gap-1.5 bg-[var(--bg-elevated)] border border-[var(--border-mid)] text-[var(--text-muted)] px-3.5 py-1.5 rounded-full text-[11px] cursor-pointer font-mono shadow-lg hover:text-[var(--text-body)] transition-all">
                                            <ArrowDown size={11} />Scroll to bottom
                                        </button>
                                    </div>
                                )}
                            </div>
                        )}

                        {/* ── Input area ── */}
                        <div className="flex-shrink-0 px-4 pb-6 pt-2" style={{ backgroundColor: "var(--bg-surface)" }}>
                            <div className="max-w-[720px] mx-auto">

                                {selectedFile && (
                                    <div className="mb-2">
                                        <button onClick={() => setShowUploadPanel(true)} className="inline-flex items-center gap-1.5 text-[10.5px] px-2.5 py-1 rounded-lg font-mono transition-all border border-[var(--border-mid)] text-[var(--text-faint)] hover:border-[var(--accent)]/40 hover:text-[var(--accent)] hover:bg-[var(--accent-dim)] bg-transparent cursor-pointer">
                                            <span className="w-1.5 h-1.5 rounded-full bg-[var(--accent)]" />
                                            {selectedFile}
                                            {files.find(f => f.name === selectedFile)?.status === "indexing" && (<span className="flex items-center gap-0.5 text-[var(--accent)]/60"><Clock size={8} />indexing</span>)}
                                        </button>
                                    </div>
                                )}

                                {/* Composer */}
                                <div className="chat-input-focus flex flex-col bg-[var(--bg-input)] border border-[var(--border-mid)] rounded-2xl overflow-hidden transition-all duration-150">

                                    {/* ── Paste chips (multiple) shown inside composer ── */}
                                    {pasteCards.length > 0 && (
                                        <div className="flex flex-wrap px-3 pt-3">
                                            {pasteCards.map(card => (
                                                <PasteChip
                                                    key={card.id}
                                                    card={card}
                                                    onRemove={removeCard}
                                                    onClick={() => openModal(card.id)}
                                                />
                                            ))}
                                        </div>
                                    )}

                                    <textarea
                                        ref={textareaRef}
                                        value={inputValue}
                                        onChange={e => setInputValue(e.target.value)}
                                        onKeyDown={handleKeyDown}
                                        onPaste={handlePaste}
                                        placeholder={pasteCards.length > 0 ? "Add a message about the pasted content…" : !selectedFile ? "Upload a file to start…" : `Ask anything about ${selectedFile}…`}
                                        rows={1}
                                        className="flex-1 bg-transparent border-none outline-none resize-none text-[var(--text-primary)] text-[14px] leading-[1.65] font-mono px-4 pt-3.5 pb-1 overflow-y-auto"
                                        style={{ maxHeight: 200, caretColor: "var(--accent)" }}
                                    />

                                    <div className="flex items-center justify-between px-3 pb-3 pt-1">
                                        <button onClick={() => setShowUploadPanel(true)} disabled={uploading} className={`p-1.5 rounded-lg bg-transparent border-none flex-shrink-0 transition-colors ${uploading ? "opacity-50 cursor-wait" : "cursor-pointer text-[var(--text-faint)] hover:text-[var(--accent)] hover:bg-[var(--accent-dim)]"}`}>
                                            {uploading ? <Loader2 size={16} className="text-[var(--accent)] animate-spin" /> : <Paperclip size={16} />}
                                        </button>
                                        <div className="flex items-center gap-2">
                                            <span className="text-[10px] text-[var(--text-faint)] font-mono hidden sm:block">Enter to send · Shift+Enter for newline</span>
                                            <button onClick={() => handleSend()} disabled={!canSend}
                                                className={`w-8 h-8 rounded-xl flex items-center justify-center border transition-all ${canSend ? "bg-[var(--accent)] border-[var(--accent)] text-[#09090c] cursor-pointer hover:opacity-90 active:scale-90" : "bg-[var(--bg-elevated)] border-[var(--border-mid)] text-[var(--text-faint)] cursor-not-allowed opacity-50"}`}>
                                                <Send size={13} />
                                            </button>
                                        </div>
                                    </div>
                                </div>

                                <p className="text-[9.5px] text-[var(--text-faint)] text-center mt-2 tracking-widest uppercase font-mono opacity-40">
                                    Answers grounded in selected document only
                                </p>
                            </div>
                        </div>
                    </div>

                    {panelOpen && activePanel === "pdf" && (
                        <div className="flex-[0_0_48%] min-w-0 overflow-hidden flex flex-col animate-[fadeIn_0.18s_ease]">
                            <PdfViewerPanel filename={selectedFile} onClose={() => setActivePanel(null)} />
                        </div>
                    )}
                </div>
            </div>
        </>
    );
};

export default Chatbot;