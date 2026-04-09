/**
 * Chatbot.jsx — CMTI Bot v7.0
 * - No border-top separator above input area
 * - No background gradient — flat clean surface like Claude.ai
 * - Brighter, more readable dark mode from ThemeContext v7
 * - Input area: file pill + textarea grouped naturally, no dividers
 */

import React, { useState, useRef, useEffect, useCallback } from "react";
import {
    Send, Paperclip, FileText, ChevronDown,
    Upload, X, FileUp, CheckCircle, Loader2,
    ArrowDown, Plus, RefreshCw, Clock, FileSearch, Trash2, Sun, Moon, LogOut, Share2,
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
import { useAuth } from "../context/AuthContext";

/* ─── Upload Zone ─────────────────────────────────────────────── */
const UploadZone = ({ onUpload, uploading, uploadProgress }) => {
    const [dragging, setDragging] = useState(false);
    const inputRef = useRef(null);

    const handleDrop = useCallback((e) => {
        e.preventDefault(); setDragging(false);
        const file = e.dataTransfer.files[0];
        if (file) onUpload(file);
    }, [onUpload]);

    return (
        <div
            onDrop={handleDrop}
            onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
            onDragLeave={() => setDragging(false)}
            onClick={() => !uploading && inputRef.current?.click()}
            className={`relative flex flex-col items-center justify-center gap-3 rounded-xl p-8 transition-all duration-200 cursor-pointer border border-dashed ${dragging ? "border-[var(--accent)] bg-[var(--accent-dim)]" : "border-[var(--border-mid)] bg-[var(--bg-base)]"} ${uploading ? "opacity-70 pointer-events-none" : ""}`}
        >
            <input ref={inputRef} type="file" accept=".pdf,.txt" onChange={(e) => { const f = e.target.files[0]; if (f) onUpload(f); e.target.value = ""; }} className="hidden" />
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
        <div className="fixed inset-0 z-[200] flex items-center justify-center bg-black/70 backdrop-blur-sm" onClick={() => !uploading && onClose()}>
            <div className="relative w-full max-w-md mx-4 bg-[var(--bg-panel)] border border-[var(--border-mid)] rounded-2xl p-6 flex flex-col gap-5 shadow-2xl" onClick={(e) => e.stopPropagation()}>
                <div className="flex items-start justify-between">
                    <div>
                        <h2 className="text-sm font-medium text-[var(--text-primary)] m-0" style={{ fontFamily: "'Fraunces', serif", fontStyle: "italic" }}>Upload Document</h2>
                        <p className="text-[10px] text-[var(--text-faint)] mt-1 tracking-widest uppercase font-mono">PDF or TXT · indexed automatically</p>
                    </div>
                    {!uploading && (
                        <button onClick={onClose} className="p-1.5 rounded-lg bg-transparent border border-[var(--border-mid)] cursor-pointer text-[var(--text-muted)] flex items-center justify-center transition-all hover:bg-[var(--bg-elevated)] hover:text-[var(--text-primary)]">
                            <X size={13} />
                        </button>
                    )}
                </div>
                <UploadZone onUpload={handleUploadFile} uploading={uploading} uploadProgress={uploadProgress} />
                {!uploading && files.length > 0 && (
                    <div>
                        <p className="text-[10px] text-[var(--text-faint)] tracking-widest uppercase mb-2 font-mono">Indexed documents</p>
                        <div className="flex flex-col gap-0.5 max-h-48 overflow-y-auto">
                            {files.map((f) => (
                                <div key={f.name} className={`flex items-center gap-2 px-2.5 py-1.5 rounded-lg border transition-all ${selectedFile === f.name ? "bg-[var(--accent-dim)] border-[var(--accent)]/30" : "border-transparent"}`}>
                                    <button onClick={() => { setSelectedFile(f.name); onClose(); }} className={`flex items-center gap-2 flex-1 text-left bg-transparent border-none cursor-pointer text-xs font-mono ${selectedFile === f.name ? "text-[var(--accent)]" : "text-[var(--text-muted)]"}`}>
                                        <FileText size={11} className="flex-shrink-0" />
                                        <span className="flex-1 overflow-hidden text-ellipsis whitespace-nowrap">{f.name}</span>
                                        {f.status === "indexing" && <span className="text-[10px] text-[var(--accent)]/60 flex items-center gap-1"><Clock size={9} />indexing</span>}
                                        {f.status === "ready" && selectedFile === f.name && <CheckCircle size={11} className="text-[var(--accent)]" />}
                                    </button>
                                    <button onClick={(e) => { e.stopPropagation(); handleReindex(f.name); }} title="Re-index" className="p-1 rounded bg-transparent border-none cursor-pointer text-[var(--text-faint)] hover:text-[var(--text-muted)] hover:bg-[var(--bg-elevated)] transition-all">
                                        <RefreshCw size={10} />
                                    </button>
                                </div>
                            ))}
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
};

/* ─── Document Viewer Panel (Enhanced UX) ───────────────────────*/
const PdfViewerPanel = ({ filename, onClose }) => {
    const { getFileUrl } = useApp();
    const [fileError, setFileError] = useState(false);
    const [loading, setLoading] = useState(true);
    const isPdf = filename?.toLowerCase().endsWith(".pdf");
    const isTxt = filename?.toLowerCase().endsWith(".txt");
    const isSupported = isPdf || isTxt;
    const fileUrl = isSupported ? getFileUrl(filename) : null;

    // Get file type label
    const fileType = isPdf ? "PDF" : isTxt ? "Text" : "Document";

    return (
        <div className="flex flex-col h-full bg-[var(--bg-base)] rounded-2xl overflow-hidden border border-[var(--border-mid)] shadow-lg">
            {/* Premium Header */}
            <div className="flex items-center justify-between px-5 py-3.5 flex-shrink-0 border-b border-[var(--border-mid)] bg-gradient-to-r from-[var(--bg-panel)] to-[var(--bg-base)]">
                <div className="flex items-center gap-3 flex-1 min-w-0">
                    <div className="w-10 h-10 rounded-lg bg-[var(--accent-dim)] flex items-center justify-center flex-shrink-0">
                        <FileSearch size={16} className="text-[var(--accent)]" />
                    </div>
                    <div className="flex-1 min-w-0">
                        <p className="text-[10px] text-[var(--text-faint)] font-mono tracking-wide uppercase mb-0.5">Document</p>
                        <p className="text-xs text-[var(--text-primary)] font-semibold truncate" title={filename}>{filename || "No file selected"}</p>
                    </div>
                </div>
                <div className="flex items-center gap-2 flex-shrink-0 ml-2">
                    {fileError && fileUrl && (
                        <a href={fileUrl} target="_blank" rel="noopener noreferrer" title="Open in new tab" className="p-2 rounded-lg bg-[var(--accent-dim)] border border-[var(--border)] cursor-pointer text-[var(--accent)] hover:bg-[var(--accent)] hover:text-white transition-all duration-200">
                            <Share2 size={14} />
                        </a>
                    )}
                    {fileUrl && (
                        <a href={fileUrl} download title="Download" className="p-2 rounded-lg bg-transparent border border-[var(--border)] cursor-pointer text-[var(--text-muted)] hover:bg-[var(--bg-elevated)] hover:text-[var(--accent)] transition-all duration-200">
                            <Upload size={14} />
                        </a>
                    )}
                    <button onClick={onClose} title="Close (Esc)" className="p-2 rounded-lg bg-transparent border border-[var(--border)] cursor-pointer text-[var(--text-faint)] hover:bg-[var(--bg-elevated)] hover:text-[var(--text-primary)] transition-all duration-200">
                        <X size={14} />
                    </button>
                </div>
            </div>

            {/* Enhanced Viewer */}
            <div className="flex-1 overflow-hidden relative bg-white flex flex-col">
                {/* Loading State - Enhanced */}
                {loading && fileUrl && !fileError && (
                    <div className="absolute inset-0 flex flex-col items-center justify-center bg-gradient-to-b from-white via-white to-[var(--bg-base)] z-20 backdrop-blur-xs">
                        <div className="flex flex-col items-center gap-3">
                            <div className="relative w-14 h-14">
                                <Loader2 size={56} className="text-[var(--accent)] animate-spin absolute inset-0" />
                                <div className="absolute inset-2 rounded-full bg-[var(--accent-dim)]" />
                            </div>
                            <div className="text-center">
                                <p className="text-sm font-semibold text-[var(--text-primary)]">Loading {fileType}</p>
                                <p className="text-[11px] text-[var(--text-faint)] mt-1">Please wait…</p>
                            </div>
                        </div>
                    </div>
                )}

                {/* iFrame Viewer */}
                {fileUrl && !fileError && (
                    <iframe
                        src={fileUrl}
                        title="File Viewer"
                        className="w-full h-full border-none flex-1 bg-white"
                        onLoad={() => setLoading(false)}
                        onError={() => {
                            setLoading(false);
                            setFileError(true);
                        }}
                        allow="fullscreen"
                    />
                )}

                {/* Empty/Error State - Redesigned */}
                {(!fileUrl || fileError) && (
                    <div className="flex-1 flex flex-col items-center justify-center gap-6 px-8 py-12 bg-gradient-to-br from-[var(--bg-elevated)] via-[var(--bg-base)] to-[var(--bg-panel)]">
                        <div className="relative">
                            <div className="absolute inset-0 bg-[var(--accent-dim)] rounded-2xl blur-xl opacity-30" />
                            <div className="relative w-20 h-20 rounded-2xl bg-[var(--bg-panel)] border-2 border-[var(--border-mid)] flex items-center justify-center">
                                <FileSearch size={40} className="text-[var(--accent)] opacity-60" />
                            </div>
                        </div>

                        <div className="text-center max-w-sm">
                            <h3 className="text-sm font-bold text-[var(--text-primary)] mb-2">
                                {!filename
                                    ? "No Document Selected"
                                    : !isSupported
                                        ? "File Not Supported"
                                        : "Unable to Load"}
                            </h3>
                            <p className="text-xs text-[var(--text-faint)] leading-relaxed mb-4">
                                {fileError
                                    ? "We couldn't load this file. This might be a temporary issue."
                                    : !filename
                                        ? "Select a PDF or TXT file from the documents list to preview it here."
                                        : "Only PDF and TXT files can be previewed. Other formats can still be downloaded."}
                            </p>

                            {/* Action Buttons */}
                            <div className="flex flex-col gap-2 mt-5">
                                {fileError && fileUrl && (
                                    <>
                                        <a href={fileUrl} target="_blank" rel="noopener noreferrer" className="inline-flex items-center justify-center gap-2 px-4 py-2 bg-[var(--accent)] text-white text-xs font-semibold rounded-lg hover:bg-[var(--accent-hover)] transition-all duration-200">
                                            <Share2 size={13} />
                                            Open in New Tab
                                        </a>
                                        <a href={fileUrl} download className="inline-flex items-center justify-center gap-2 px-4 py-2 bg-[var(--bg-elevated)] text-[var(--accent)] text-xs font-semibold rounded-lg border border-[var(--border-mid)] hover:bg-[var(--bg-panel)] transition-all duration-200">
                                            <Upload size={13} />
                                            Download File
                                        </a>
                                    </>
                                )}
                                {!filename && (
                                    <p className="text-[10px] text-[var(--text-faint)] mt-2 italic">💡 Tip: Select a document from the list on the left</p>
                                )}
                            </div>
                        </div>
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
            div: ({ className, children, ...props }) => {
                if (className?.includes("math-display"))
                    return <div className="my-3 px-4 py-3 bg-[var(--bg-base)] border border-[var(--border-mid)] rounded-lg overflow-x-auto text-center" {...props}>{children}</div>;
                return <div className={className} {...props}>{children}</div>;
            },
            span: ({ className, children, ...props }) => {
                if (className?.includes("math-inline"))
                    return <span className="px-1.5 py-0.5 rounded bg-[var(--accent-dim)] text-[var(--accent)] font-mono text-[0.875em]" {...props}>{children}</span>;
                return <span className={className} {...props}>{children}</span>;
            },
            table: ({ ...props }) => <div className="overflow-x-auto my-3 rounded-lg border border-[var(--border-mid)] w-full"><table className="border-collapse text-[12.5px] w-full font-mono" style={{ tableLayout: "fixed", wordBreak: "break-word" }} {...props} /></div>,
            thead: ({ ...props }) => <thead className="bg-[var(--bg-elevated)]" {...props} />,
            th: ({ ...props }) => <th className="border-none border-b border-[var(--border-mid)] px-3.5 py-2.5 text-left font-semibold text-[var(--text-primary)] text-[10.5px] tracking-widest uppercase" {...props} />,
            td: ({ ...props }) => <td className="border-none border-b border-[var(--border)] px-3.5 py-2 text-[var(--text-body)] text-[12.5px] leading-relaxed align-top" style={{ wordBreak: "break-word" }} {...props} />,
            tr: ({ ...props }) => <tr className="transition-colors hover:bg-[var(--accent-dim)]" {...props} />,
            tbody: ({ ...props }) => <tbody {...props} />,
            code: ({ inline, children, ...props }) =>
                inline
                    ? <code className="bg-[var(--accent-dim)] px-1.5 py-0.5 rounded text-[var(--accent)] text-[0.84em] font-mono" {...props}>{children}</code>
                    : <pre className="bg-[var(--code-bg)] border border-[var(--border)] rounded-lg px-4 py-3.5 overflow-x-auto my-3"><code className="text-[#d4d4d0] text-[0.8em] font-mono leading-7" {...props}>{children}</code></pre>,
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
    >
        {normaliseContent(content)}
    </ReactMarkdown>
);

/* ─── Think Block ────────────────────────────────────────────── */
const ThinkBlock = ({ thinking, done }) => {
    const [open, setOpen] = useState(false);
    const secs = Math.max(1, Math.round(thinking.length / 200));
    return (
        <div className="mb-2.5">
            <button onClick={() => setOpen((o) => !o)} className={`flex items-center gap-1.5 bg-transparent border-none cursor-pointer p-0 text-[11px] font-mono tracking-wide ${done ? "text-[var(--text-faint)]" : "text-[var(--accent)]/70"}`}>
                {!done ? <Loader2 size={11} className="animate-spin text-[var(--accent)]" /> : <span className="text-[10px]">{open ? "▲" : "▼"}</span>}
                {done ? `Thought for ${secs}s` : "Thinking…"}
            </button>
            {open && done && (
                <div className="mt-1.5 px-3.5 py-2.5 bg-[var(--bg-base)] border border-[var(--border)] rounded-lg text-[11.5px] text-[var(--text-muted)] font-mono leading-7 whitespace-pre-wrap">{thinking}</div>
            )}
        </div>
    );
};

/* ─── Typing dots ────────────────────────────────────────────── */
const TypingDots = () => (
    <div className="flex gap-1.5 items-center py-1">
        {[0, 140, 280].map((delay, i) => (
            <span key={i} className="w-1.5 h-1.5 rounded-full bg-[var(--text-faint)] block animate-[bounce_1.2s_ease-in-out_infinite]" style={{ animationDelay: `${delay}ms` }} />
        ))}
    </div>
);

/* ─── FileOption ─────────────────────────────────────────────── */
const FileOption = ({ name, status, selected, onSelect, onDelete }) => (
    <div className={`flex items-center gap-0.5 w-full transition-colors ${selected ? "bg-[var(--accent-dim)]" : "hover:bg-[var(--bg-elevated)]"}`}>
        <button onClick={onSelect} className={`flex-1 text-left px-3.5 py-2 text-xs flex items-center gap-2 bg-transparent border-none cursor-pointer font-mono tracking-wide overflow-hidden ${selected ? "text-[var(--accent)]" : "text-[var(--text-muted)]"}`}>
            <FileText size={11} className="flex-shrink-0" />
            <span className="flex-1 overflow-hidden text-ellipsis whitespace-nowrap">{name}</span>
            {status === "indexing" && <Clock size={10} className="text-[var(--accent)]/60 flex-shrink-0" />}
            {selected && status !== "indexing" && <CheckCircle size={11} className="flex-shrink-0 text-[var(--accent)]" />}
        </button>
        <button onClick={(e) => { e.stopPropagation(); onDelete(name); }} title="Delete" className="px-3 py-2 bg-transparent border-none cursor-pointer text-[var(--text-faint)] flex hover:text-red-500 transition-colors">
            <Trash2 size={11} />
        </button>
    </div>
);

/* ─── Suggested Questions ────────────────────────────────────── */
const SuggestedQuestions = ({ file, onSelect }) => {
    if (!file) return null;
    const prompts = ["Summarize this document", "What are the key findings?", "List all tables and figures", "What are the main conclusions?"];
    return (
        <div className="flex flex-wrap gap-2 justify-center max-w-lg">
            {prompts.map((p) => (
                <button key={p} onClick={() => onSelect(p)} className="px-4 py-2 rounded-lg bg-[var(--bg-elevated)] border border-[var(--border-mid)] text-[var(--text-body)] text-xs cursor-pointer font-mono tracking-wide transition-all hover:border-[var(--accent)]/40 hover:text-[var(--accent)] hover:bg-[var(--accent-dim)]">
                    {p}
                </button>
            ))}
        </div>
    );
};

/* ─── Panel Tab Button ───────────────────────────────────────── */
const PanelTabBtn = ({ active, onClick, children }) => (
    <button onClick={onClick} className={`flex items-center gap-1 px-3 py-1.5 rounded-md text-[11.5px] cursor-pointer font-mono tracking-wide transition-all ${active ? "bg-[var(--accent-dim)] border border-[var(--accent)]/35 text-[var(--accent)]" : "bg-transparent border border-[var(--border-mid)] text-[var(--text-muted)] hover:bg-[var(--bg-elevated)] hover:text-[var(--text-body)]"}`}>
        {children}
    </button>
);

/* ─── Theme Toggle ───────────────────────────────────────────── */
const ThemeToggle = () => {
    const { isDark, toggleTheme } = useTheme();
    return (
        <button onClick={toggleTheme} title={isDark ? "Light mode" : "Dark mode"} className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-md bg-transparent border border-[var(--border-mid)] text-[var(--text-muted)] text-[11px] font-mono cursor-pointer transition-all hover:bg-[var(--bg-elevated)] hover:text-[var(--text-body)]">
            {isDark ? <Sun size={12} /> : <Moon size={12} />}
            {isDark ? "Light" : "Dark"}
        </button>
    );
};

/* ─── User Menu ──────────────────────────────────────────────── */
const UserMenu = () => {
    const { user, logout } = useAuth();
    const navigate = useNavigate();
    const [showMenu, setShowMenu] = useState(false);

    const handleLogout = async () => {
        await logout();
        navigate("/auth/login");
    };

    return (
        <div className="relative">
            <button
                onClick={() => setShowMenu(!showMenu)}
                className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-md bg-transparent border border-[var(--border-mid)] text-[var(--text-muted)] text-[11px] font-mono cursor-pointer transition-all hover:bg-[var(--bg-elevated)] hover:text-[var(--text-body)]"
                title={user?.username || "User"}
            >
                <div className="w-3 h-3 rounded-full bg-[var(--accent)] flex-shrink-0" />
                {user?.username}
            </button>
            {showMenu && (
                <div className="absolute right-0 top-full mt-1 w-40 bg-[var(--bg-panel)] border border-[var(--border-mid)] rounded-lg shadow-lg z-50 overflow-hidden">
                    <div className="px-3 py-2.5 border-b border-[var(--border-mid)]">
                        <p className="text-[10.5px] text-[var(--text-faint)] font-mono tracking-widest uppercase">Logged in</p>
                        <p className="text-xs text-[var(--text-primary)] font-mono truncate mt-0.5">{user?.email}</p>
                    </div>
                    <button
                        onClick={handleLogout}
                        className="w-full flex items-center gap-2 px-3 py-2.5 text-left text-[11px] text-[var(--text-muted)] hover:bg-[var(--bg-base)] hover:text-[var(--text-primary)] transition-colors border-none bg-transparent cursor-pointer font-mono"
                    >
                        <LogOut size={12} />
                        Logout
                    </button>
                </div>
            )}
        </div>
    );
};

/* ─── Main Chatbot ───────────────────────────────────────────── */
const Chatbot = () => {
    const navigate = useNavigate();
    const { files, selectedFile, setSelectedFile, uploading, uploadProgress, handleUploadFile, handleDeleteFile, handleReindex, messages, setMessages, resetChat } = useApp();

    const [inputValue, setInputValue] = useState("");
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
    const handleScroll = useCallback(() => { const atBottom = checkIsAtBottom(); isAtBottomRef.current = atBottom; setShowScrollBtn(!atBottom); if (atBottom) setUserScrolled(false); else setUserScrolled(true); }, [checkIsAtBottom]);

    useEffect(() => { if (!userScrolled) scrollToBottom("smooth"); }, [messages, userScrolled, scrollToBottom]);
    useEffect(() => { if (isTyping && isAtBottomRef.current) scrollToBottom("auto"); }, [messages, isTyping, scrollToBottom]);
    useEffect(() => { if (textareaRef.current) { textareaRef.current.style.height = "auto"; textareaRef.current.style.height = `${Math.min(textareaRef.current.scrollHeight, 160)}px`; } }, [inputValue]);

    const handleSend = async (overrideText) => {
        const text = overrideText || inputValue;
        if (!text.trim()) return;
        if (!selectedFile) {
            setMessages((prev) => [...prev, { id: Date.now(), type: "bot", content: "Please upload or select a file first.", timestamp: new Date() }]);
            return;
        }
        const userMsg = { id: Date.now(), type: "user", content: text, timestamp: new Date() };
        setMessages((prev) => [...prev, userMsg]);
        setInputValue(""); setIsTyping(true); setUserScrolled(false); isAtBottomRef.current = true;
        const botId = Date.now() + 1;
        setMessages((prev) => [...prev, { id: botId, type: "bot", content: "", timestamp: new Date(), thinking: "", thinkDone: false }]);

        try {
            const response = await fetch(`${API}/generate`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ prompt: userMsg.content, filename: selectedFile, temperature: 0.4, max_output_tokens: 1024, top_p: 0.9 }) });
            const contentType = response.headers.get("content-type") || "";
            if (contentType.includes("application/json")) {
                const data = await response.json();
                setMessages((prev) => prev.map((msg) => msg.id === botId ? { ...msg, content: data.response || "" } : msg));
                return;
            }
            const tokenQueue = [];
            const DRIP_INTERVAL = 18, CHARS_PER_TICK = 2;
            const drip = setInterval(() => {
                if (tokenQueue.length === 0) return;
                const chunk = tokenQueue.splice(0, CHARS_PER_TICK).join("");
                setMessages((prev) => prev.map((msg) => msg.id === botId ? { ...msg, content: msg.content + chunk } : msg));
                if (isAtBottomRef.current) scrollToBottom("auto");
            }, DRIP_INTERVAL);
            const reader = response.body.getReader(), decoder = new TextDecoder();
            let buffer = "";
            while (true) {
                const { done, value } = await reader.read();
                if (done) break;
                buffer += decoder.decode(value, { stream: true });
                const lines = buffer.split("\n"); buffer = lines.pop();
                for (const line of lines) {
                    if (!line.startsWith("data: ")) continue;
                    const data = line.slice(6).trim();
                    if (data === "[DONE]") break;
                    try {
                        const json = JSON.parse(data);
                        if (json.images) continue;
                        if (json.think_token) { setMessages((prev) => prev.map((msg) => msg.id === botId ? { ...msg, thinking: (msg.thinking || "") + json.think_token } : msg)); continue; }
                        if (json.think_end) { setMessages((prev) => prev.map((msg) => msg.id === botId ? { ...msg, thinkDone: true } : msg)); continue; }
                        const token = json.token || "";
                        if (token) tokenQueue.push(...token.split(""));
                    } catch { }
                }
            }
            await new Promise((resolve) => { const drain = setInterval(() => { if (tokenQueue.length === 0) { clearInterval(drain); resolve(); return; } const chunk = tokenQueue.splice(0, CHARS_PER_TICK).join(""); setMessages((prev) => prev.map((msg) => msg.id === botId ? { ...msg, content: msg.content + chunk } : msg)); if (isAtBottomRef.current) scrollToBottom("auto"); }, DRIP_INTERVAL); });
            clearInterval(drip);
        } catch (error) {
            setMessages((prev) => prev.map((msg) => msg.id === botId ? { ...msg, content: `Error: ${error.message}` } : msg));
        } finally {
            setIsTyping(false);
        }
    };

    const handleKeyDown = (e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); handleSend(); } };
    const togglePanel = (panel) => setActivePanel((prev) => (prev === panel ? null : panel));
    const isEmpty = files.length === 0 && messages.length <= 1;
    const hasFileButEmpty = files.length > 0 && messages.length <= 1;
    const panelOpen = activePanel !== null;

    return (
        <>
            <link rel="preconnect" href="https://fonts.googleapis.com" />
            <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="" />
            <link href="https://fonts.googleapis.com/css2?family=Fraunces:ital,opsz,wght@0,9..144,300;0,9..144,500;1,9..144,300&family=DM+Mono:wght@300;400;500&display=swap" rel="stylesheet" />
            <style>{`
                @keyframes fadeSlideUp { from{opacity:0;transform:translateY(10px)} to{opacity:1;transform:translateY(0)} }
                @keyframes fadeIn { from{opacity:0} to{opacity:1} }
                @keyframes modalIn { from{opacity:0;transform:scale(.97) translateY(6px)} to{opacity:1;transform:scale(1) translateY(0)} }
                @keyframes bounce { 0%,80%,100%{transform:translateY(0);opacity:.35} 40%{transform:translateY(-5px);opacity:1} }
                @keyframes scrollBtnIn { from{opacity:0;transform:translateX(-50%) translateY(6px)} to{opacity:1;transform:translateX(-50%) translateY(0)} }
                .cb-msg-bot { animation: fadeSlideUp 0.2s ease forwards; }
                .cb-msg-user { animation: fadeSlideUp 0.15s ease forwards; }
                ::-webkit-scrollbar { width: 4px; height: 4px; }
                ::-webkit-scrollbar-track { background: transparent; }
                ::-webkit-scrollbar-thumb { background: var(--scrollbar); border-radius: 99px; }
            `}</style>

            <div className="relative flex flex-col h-screen overflow-hidden" style={{ background: "var(--bg-surface)", color: "var(--text-body)", fontFamily: "'DM Mono', monospace" }}>

                {showUploadPanel && <UploadPanel onClose={() => setShowUploadPanel(false)} />}

                {/* ── Top Bar ── */}
                <div className="border-b border-[var(--border)] px-4 h-14 flex items-center justify-between flex-shrink-0 sticky top-0 z-[100]" style={{ backgroundColor: "var(--bg-panel)" }}>
                    <div className="flex items-center gap-2.5">
                        <div className="w-8 h-8 rounded-lg bg-[var(--accent-dim)] border border-[var(--accent)]/30 flex items-center justify-center">
                            <span className="text-[var(--accent)] text-base leading-none">◈</span>
                        </div>
                        <div>
                            <div className="text-[13.5px] font-medium text-[var(--text-primary)]" style={{ fontFamily: "'Fraunces', serif" }}>CMTI Bot</div>
                            <div className="text-[9.5px] text-[var(--text-faint)] tracking-widest uppercase font-mono">Document Intelligence</div>
                        </div>
                    </div>

                    <div className="flex items-center gap-1.5">
                        <ThemeToggle />
                        <UserMenu />
                        <button onClick={resetChat} className="flex items-center gap-1 bg-transparent border border-[var(--border-mid)] text-[var(--text-muted)] px-3 py-1.5 rounded-md text-[11.5px] cursor-pointer font-mono transition-all hover:bg-[var(--bg-elevated)] hover:text-[var(--text-body)]">
                            <Plus size={11} />New chat
                        </button>
                        {selectedFile && (
                            <>
                                <PanelTabBtn active={activePanel === "pdf"} onClick={() => togglePanel("pdf")}>
                                    <FileSearch size={11} />PDF
                                </PanelTabBtn>
                                <button onClick={() => navigate("/report")} className="flex items-center gap-1 px-3 py-1.5 rounded-md text-[11.5px] cursor-pointer font-mono bg-[var(--teal-dim)] border border-[var(--teal)]/25 text-[var(--teal)] transition-all hover:bg-[var(--teal)]/15">
                                    <FileText size={11} />Report
                                </button>
                            </>
                        )}
                        <button onClick={() => setShowUploadPanel(true)} disabled={uploading} className={`flex items-center gap-1 px-3 py-1.5 rounded-md text-[11.5px] font-mono transition-all ${uploading ? "bg-transparent border border-[var(--border-mid)] text-[var(--text-faint)] opacity-70 cursor-wait" : "bg-[var(--accent-dim)] border border-[var(--accent)]/32 text-[var(--accent)] cursor-pointer hover:bg-[var(--accent)]/18"}`}>
                            {uploading ? <Loader2 size={11} className="animate-spin" /> : <Upload size={11} />}
                            {uploading ? "Indexing…" : "Upload"}
                        </button>

                        {/* File dropdown */}
                        <div className="relative">
                            {showDropdown && <div className="fixed inset-0 z-[1]" onClick={() => setShowDropdown(false)} />}
                            <button onClick={() => setShowDropdown((p) => !p)} className={`relative z-[3] flex items-center gap-1.5 px-3 py-1.5 rounded-md text-[11.5px] font-mono max-w-[220px] transition-all border ${showDropdown ? "bg-[var(--bg-elevated)] border-[var(--border)] text-[var(--text-body)]" : "bg-transparent border-[var(--border-mid)] text-[var(--text-body)] hover:bg-[var(--bg-elevated)]"}`}>
                                <span className="w-1.5 h-1.5 rounded-full bg-[var(--accent)] flex-shrink-0" />
                                <span className="overflow-hidden text-ellipsis whitespace-nowrap flex-1 max-w-[150px]">{selectedFile || "No file"}</span>
                                {files.find((f) => f.name === selectedFile)?.status === "indexing" && <Clock size={9} className="text-[var(--accent)]/60 flex-shrink-0" />}
                                <ChevronDown size={10} className={`text-[var(--text-muted)] flex-shrink-0 transition-transform ${showDropdown ? "rotate-180" : ""}`} />
                            </button>
                            {showDropdown && (
                                <div className="absolute right-0 top-[calc(100%+6px)] w-72 bg-[var(--bg-panel)] border border-[var(--border-mid)] rounded-xl shadow-2xl z-[2] overflow-hidden animate-[fadeIn_0.12s_ease]">
                                    {files.length === 0
                                        ? <p className="text-[var(--text-faint)] text-xs px-4 py-3.5 font-mono">No files indexed yet</p>
                                        : files.map((f) => <FileOption key={f.name} name={f.name} status={f.status} selected={selectedFile === f.name} onSelect={() => { setSelectedFile(f.name); setShowDropdown(false); }} onDelete={handleDeleteFile} />)}
                                </div>
                            )}
                        </div>
                    </div>
                </div>

                {/* ── Main area ── */}
                <div className="flex-1 flex overflow-hidden">

                    {/* Chat pane */}
                    <div className={`flex flex-col overflow-hidden transition-all duration-300 ease-[cubic-bezier(0.4,0,0.2,1)] ${panelOpen ? "flex-[0_0_50%] border-r border-[var(--border)]" : "flex-1"}`}>

                        {/* Welcome */}
                        {(isEmpty || hasFileButEmpty) && (
                            <div className="flex-1 flex flex-col items-center justify-center gap-6 px-6 animate-[fadeSlideUp_0.3s_ease]">
                                <div className="w-14 h-14 rounded-2xl bg-[var(--accent-dim)] border border-[var(--accent)]/20 flex items-center justify-center">
                                    <span className="text-[26px] text-[var(--accent)]">◈</span>
                                </div>
                                <div className="text-center">
                                    <p className="text-lg font-light text-[var(--text-primary)] m-0" style={{ fontFamily: "'Fraunces', serif", fontStyle: "italic" }}>
                                        {isEmpty ? "No documents loaded" : `Query · ${selectedFile}`}
                                    </p>
                                    <p className="text-xs text-[var(--text-muted)] mt-2 tracking-wide font-mono">
                                        {isEmpty ? "Upload a PDF or TXT to begin" : "Type a question or pick a prompt below"}
                                    </p>
                                </div>
                                {isEmpty
                                    ? <button onClick={() => setShowUploadPanel(true)} className="flex items-center gap-2 bg-[var(--accent)] text-[#09090c] px-5 py-2.5 rounded-lg text-[12.5px] font-bold border-none cursor-pointer font-mono tracking-widest uppercase transition-all hover:bg-[var(--accent-hover)]"><Upload size={14} />Upload a document</button>
                                    : <SuggestedQuestions file={selectedFile} onSelect={(t) => handleSend(t)} />}
                            </div>
                        )}

                        {/* Messages */}
                        {!isEmpty && !hasFileButEmpty && (
                            <div ref={scrollContainerRef} onScroll={handleScroll} className="flex-1 overflow-y-auto px-6 pt-7 pb-4 flex flex-col">
                                <div className="max-w-[720px] w-full mx-auto flex flex-col gap-6">
                                    {messages.map((msg, idx) => (
                                        <div key={msg.id} className={`flex ${msg.type === "user" ? "justify-end cb-msg-user" : "justify-start cb-msg-bot"}`} style={{ animationDelay: `${Math.min(idx * 0.03, 0.18)}s`, animationFillMode: "both" }}>
                                            {msg.type === "user"
                                                ? <div className="max-w-[72%] bg-[var(--user-bubble)] border border-[var(--border-mid)] text-[var(--text-primary)] px-4 py-3 rounded-[10px_10px_3px_10px] text-[13.5px] leading-7 font-mono">{msg.content}</div>
                                                : (
                                                    <div className="flex gap-3 max-w-full items-start w-full">
                                                        <div className="w-8 h-8 rounded-lg flex-shrink-0 bg-[var(--accent-dim)] border border-[var(--accent)]/25 flex items-center justify-center mt-0.5">
                                                            <span className="text-[var(--accent)] text-sm">◈</span>
                                                        </div>
                                                        <div className="flex-1 min-w-0 overflow-x-hidden pt-1">
                                                            {msg.thinking && <ThinkBlock thinking={msg.thinking} done={msg.thinkDone} />}
                                                            {msg.content ? <MarkdownMessage content={msg.content} /> : isTyping && idx === messages.length - 1 ? <TypingDots /> : null}
                                                        </div>
                                                    </div>
                                                )}
                                        </div>
                                    ))}
                                    <div ref={messagesEndRef} className="h-px" />
                                </div>
                                {showScrollBtn && (
                                    <button onClick={() => { setUserScrolled(false); scrollToBottom("smooth"); }} className="sticky bottom-2 left-1/2 -translate-x-1/2 flex items-center gap-1.5 bg-[var(--bg-elevated)] border border-[var(--border-mid)] text-[var(--text-muted)] px-4 py-1.5 rounded-md text-[11.5px] cursor-pointer font-mono shadow-xl whitespace-nowrap w-fit mx-auto">
                                        <ArrowDown size={12} />Scroll to bottom
                                    </button>
                                )}
                            </div>
                        )}

                        {/* ── Input area — no border-top, no extra separator ── */}
                        <div className="px-4 pb-5 pt-3 flex-shrink-0" style={{ backgroundColor: "var(--bg-surface)" }}>
                            <div className="max-w-[720px] mx-auto flex flex-col gap-2">

                                {/* File pill — sits naturally above the box */}
                                {selectedFile && (
                                    <div>
                                        <span onClick={() => setShowUploadPanel(true)} className="inline-flex items-center gap-1.5 bg-[var(--bg-elevated)] border border-[var(--border-mid)] text-[var(--text-muted)] text-[11px] px-3 py-1 rounded-md cursor-pointer font-mono transition-all hover:border-[var(--accent)]/40 hover:text-[var(--accent)]">
                                            <span className="w-1.5 h-1.5 rounded-full bg-[var(--accent)]" />
                                            {selectedFile}
                                            {files.find((f) => f.name === selectedFile)?.status === "indexing" && (
                                                <span className="flex items-center gap-1 text-[var(--accent)]/60"><Clock size={8} />indexing…</span>
                                            )}
                                        </span>
                                    </div>
                                )}

                                {/* Input box */}
                                <div className="flex items-end gap-2 bg-[var(--bg-input)] border border-[var(--border-mid)] rounded-xl px-3.5 py-2.5 transition-all focus-within:border-[var(--accent)]/40 focus-within:shadow-[0_0_0_3px_var(--accent-dim)]">
                                    <button onClick={() => setShowUploadPanel(true)} disabled={uploading} className={`p-1.5 rounded-md bg-transparent border-none flex-shrink-0 flex transition-colors mb-0.5 ${uploading ? "opacity-50 cursor-wait" : "cursor-pointer text-[var(--text-faint)] hover:text-[var(--accent)]"}`}>
                                        {uploading ? <Loader2 size={15} className="text-[var(--accent)] animate-spin" /> : <Paperclip size={15} />}
                                    </button>
                                    <textarea ref={textareaRef} value={inputValue} onChange={(e) => setInputValue(e.target.value)} onKeyDown={handleKeyDown} placeholder={!selectedFile ? "Upload a file to start…" : `Ask about ${selectedFile}…`} rows={1} className="flex-1 bg-transparent border-none outline-none resize-none text-[var(--text-primary)] text-[13.5px] leading-[1.65] font-mono py-1 overflow-y-auto" style={{ maxHeight: 160, caretColor: "var(--accent)" }} />
                                    <button onClick={() => handleSend()} disabled={!inputValue.trim() || !selectedFile || uploading} className={`w-9 h-9 rounded-lg flex-shrink-0 flex items-center justify-center border transition-all mb-0.5 ${inputValue.trim() && selectedFile && !uploading ? "bg-[var(--accent)] border-[var(--accent)] text-[#09090c] cursor-pointer hover:bg-[var(--accent-hover)] active:scale-90" : "bg-[var(--bg-elevated)] border-[var(--border-mid)] text-[var(--text-faint)] cursor-not-allowed"}`}>
                                        <Send size={14} />
                                    </button>
                                </div>

                                <p className="text-[10px] text-[var(--text-faint)] text-center tracking-widest uppercase font-mono opacity-50">
                                    Answers grounded in selected document only
                                </p>
                            </div>
                        </div>
                    </div>

                    {/* Right Document Panel */}
                    {panelOpen && activePanel === "pdf" && (
                        <div className="flex-[0_0_50%] min-w-0 overflow-hidden flex flex-col animate-[fadeIn_0.2s_ease] bg-[var(--bg-base)] p-2">
                            <PdfViewerPanel filename={selectedFile} onClose={() => setActivePanel(null)} />
                        </div>
                    )}
                </div>
            </div>
        </>
    );
};

export default Chatbot;