import React, { useState, useRef, useEffect, useCallback } from 'react';
import {
    Send, Paperclip, FileText, ChevronDown,
    Upload, X, FileUp, CheckCircle, Loader2,
    ArrowDown, Plus, RefreshCw, Clock, FileSearch
} from 'lucide-react';
import axios from 'axios';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';
import rehypeKatex from 'rehype-katex';
import rehypeRaw from 'rehype-raw';
import 'katex/dist/katex.min.css';
import ReportPanel from './Reportpanel';

const API = 'http://127.0.0.1:8080';

/* ─────────────────────────────────────────
   Drag-and-Drop Upload Zone
───────────────────────────────────────── */
const UploadZone = ({ onUpload, uploading, uploadProgress }) => {
    const [dragging, setDragging] = useState(false);
    const inputRef = useRef(null);

    const handleDrop = useCallback((e) => {
        e.preventDefault();
        setDragging(false);
        const file = e.dataTransfer.files[0];
        if (file) onUpload(file);
    }, [onUpload]);

    return (
        <div
            onDrop={handleDrop}
            onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
            onDragLeave={() => setDragging(false)}
            onClick={() => !uploading && inputRef.current?.click()}
            style={{
                position: 'relative', display: 'flex', flexDirection: 'column',
                alignItems: 'center', justifyContent: 'center', gap: 14,
                border: `1.5px dashed ${dragging ? '#c8a96e' : '#252530'}`,
                borderRadius: 10, padding: '36px 24px',
                cursor: uploading ? 'wait' : 'pointer', transition: 'all 0.2s ease',
                background: dragging ? 'rgba(200,169,110,0.05)' : 'rgba(10,10,13,0.6)',
                opacity: uploading ? 0.85 : 1,
                pointerEvents: uploading ? 'none' : 'auto',
            }}
        >
            <input ref={inputRef} type="file" accept=".pdf,.txt"
                onChange={(e) => { const f = e.target.files[0]; if (f) onUpload(f); e.target.value = ''; }}
                style={{ display: 'none' }} />
            <div style={{
                width: 44, height: 44, borderRadius: 10,
                background: dragging ? 'rgba(200,169,110,0.1)' : '#111116',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                border: `1px solid ${dragging ? 'rgba(200,169,110,0.4)' : '#1e1e26'}`,
                transition: 'all 0.2s',
            }}>
                {uploading
                    ? <Loader2 size={20} style={{ color: '#c8a96e', animation: 'spin 1s linear infinite' }} />
                    : <FileUp size={20} style={{ color: dragging ? '#c8a96e' : '#3a3a46' }} />}
            </div>
            <div style={{ textAlign: 'center' }}>
                <p style={{ fontSize: 13, color: '#e2e0db', margin: 0, fontFamily: "'DM Mono', monospace" }}>
                    {uploading ? uploadProgress : dragging ? 'Drop to upload' : 'Drop file here'}
                </p>
                <p style={{ fontSize: 11.5, color: '#48485a', marginTop: 4, fontFamily: "'DM Mono', monospace", letterSpacing: '0.02em' }}>
                    {uploading ? 'Processing…' : 'click to browse · PDF & TXT'}
                </p>
            </div>
            {uploading && (
                <div style={{ width: '100%', height: 1, background: '#1a1a22', borderRadius: 99, overflow: 'hidden' }}>
                    <div style={{ height: '100%', background: 'linear-gradient(90deg,#c8a96e,#d4b880)', borderRadius: 99, animation: 'shimmer 1.5s ease-in-out infinite' }} />
                </div>
            )}
        </div>
    );
};

/* ─────────────────────────────────────────
   Upload Panel / Modal
───────────────────────────────────────── */
const UploadPanel = ({ onUpload, uploading, uploadProgress, onClose, files, selectedFile, onSelectFile, onReindex }) => (
    <div
        style={{
            position: 'fixed', inset: 0, zIndex: 200,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            background: 'rgba(0,0,0,0.8)', backdropFilter: 'blur(14px)',
        }}
        onClick={() => !uploading && onClose()}
    >
        <div
            style={{
                position: 'relative', width: '100%', maxWidth: 400, margin: '0 16px',
                background: '#0d0d10', border: '1px solid #1e1e26',
                borderRadius: 14, padding: 24,
                display: 'flex', flexDirection: 'column', gap: 18,
                boxShadow: '0 32px 80px rgba(0,0,0,0.85)',
                animation: 'modalIn 0.22s cubic-bezier(0.34,1.56,0.64,1)',
                fontFamily: "'DM Mono', monospace",
            }}
            onClick={e => e.stopPropagation()}
        >
            <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between' }}>
                <div>
                    <h2 style={{ fontSize: 15, fontWeight: 500, color: '#f0ede8', margin: 0, fontFamily: "'Fraunces', serif", fontStyle: 'italic' }}>Upload Document</h2>
                    <p style={{ fontSize: 11, color: '#48485a', marginTop: 5, letterSpacing: '0.05em', textTransform: 'uppercase' }}>PDF or TXT · indexed automatically</p>
                </div>
                {!uploading && (
                    <button onClick={onClose} style={{
                        padding: 7, borderRadius: 7, background: 'transparent',
                        border: '1px solid #1e1e26', cursor: 'pointer', color: '#48485a',
                        display: 'flex', alignItems: 'center', justifyContent: 'center', transition: 'all 0.15s',
                    }}
                        onMouseEnter={e => { e.currentTarget.style.background = '#17171e'; e.currentTarget.style.color = '#e2e0db'; e.currentTarget.style.borderColor = '#2e2e3a'; }}
                        onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = '#48485a'; e.currentTarget.style.borderColor = '#1e1e26'; }}>
                        <X size={13} />
                    </button>
                )}
            </div>

            <UploadZone onUpload={onUpload} uploading={uploading} uploadProgress={uploadProgress} />

            {!uploading && files.length > 0 && (
                <div>
                    <p style={{ fontSize: 10, color: '#38384a', letterSpacing: '0.08em', textTransform: 'uppercase', marginBottom: 9 }}>
                        Indexed documents
                    </p>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 2, maxHeight: 200, overflowY: 'auto' }}>
                        {files.map(f => (
                            <div key={f.name} style={{
                                display: 'flex', alignItems: 'center', gap: 8,
                                padding: '7px 10px', borderRadius: 7,
                                background: selectedFile === f.name ? 'rgba(200,169,110,0.08)' : 'transparent',
                                border: `1px solid ${selectedFile === f.name ? 'rgba(200,169,110,0.22)' : 'transparent'}`,
                                transition: 'all 0.15s',
                            }}>
                                <button onClick={() => { onSelectFile(f.name); onClose(); }} style={{
                                    display: 'flex', alignItems: 'center', gap: 8, flex: 1, textAlign: 'left',
                                    background: 'transparent', border: 'none', cursor: 'pointer', fontSize: 12,
                                    color: selectedFile === f.name ? '#c8a96e' : '#8a8a9a',
                                    fontFamily: "'DM Mono', monospace",
                                }}>
                                    <FileText size={11} style={{ flexShrink: 0 }} />
                                    <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{f.name}</span>
                                    {f.status === 'indexing' && <span style={{ fontSize: 10, color: '#8a7040', display: 'flex', alignItems: 'center', gap: 3 }}><Clock size={9} />indexing</span>}
                                    {f.status === 'ready' && selectedFile === f.name && <CheckCircle size={11} style={{ color: '#c8a96e' }} />}
                                </button>
                                <button onClick={(e) => { e.stopPropagation(); onReindex(f.name); }} title="Re-index" style={{
                                    padding: 5, borderRadius: 5, background: 'transparent', border: '1px solid transparent',
                                    cursor: 'pointer', color: '#38384a', display: 'flex', transition: 'all 0.15s',
                                }}
                                    onMouseEnter={e => { e.currentTarget.style.background = '#17171e'; e.currentTarget.style.color = '#7070808'; }}
                                    onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = '#38384a'; }}>
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

/* ─────────────────────────────────────────
   PDF Viewer Panel
───────────────────────────────────────── */
const PdfViewerPanel = ({ filename, apiBase, onClose }) => {
    const pdfUrl = filename && filename.toLowerCase().endsWith('.pdf')
        ? `${apiBase}/files/${encodeURIComponent(filename)}`
        : null;

    return (
        <div style={{
            display: 'flex', flexDirection: 'column', height: '100%',
            background: '#09090c',
        }}>
            <div style={{
                display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                padding: '0 16px', height: 48, flexShrink: 0,
                borderBottom: '1px solid #1a1a22',
                background: '#0d0d10',
            }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <FileSearch size={13} style={{ color: '#c8a96e' }} />
                    <span style={{
                        fontSize: 12, color: '#c8c6c1',
                        fontFamily: "'DM Mono', monospace",
                        overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 260,
                    }}>
                        {filename || 'No file selected'}
                    </span>
                </div>
                <button onClick={onClose} style={{
                    padding: 6, borderRadius: 5, background: 'transparent',
                    border: '1px solid #1e1e26', cursor: 'pointer', color: '#58586a',
                    display: 'flex', transition: 'all 0.15s',
                }}
                    onMouseEnter={e => { e.currentTarget.style.color = '#e2e0db'; e.currentTarget.style.borderColor = '#3a3a48'; }}
                    onMouseLeave={e => { e.currentTarget.style.color = '#58586a'; e.currentTarget.style.borderColor = '#1e1e26'; }}>
                    <X size={12} />
                </button>
            </div>

            <div style={{ flex: 1, overflow: 'hidden', position: 'relative' }}>
                {pdfUrl ? (
                    <iframe
                        src={pdfUrl}
                        title="PDF Viewer"
                        style={{ width: '100%', height: '100%', border: 'none', background: '#09090c' }}
                    />
                ) : (
                    <div style={{
                        display: 'flex', flexDirection: 'column', alignItems: 'center',
                        justifyContent: 'center', height: '100%', gap: 12,
                        color: '#38384a', fontFamily: "'DM Mono', monospace",
                    }}>
                        <FileSearch size={28} style={{ opacity: 0.25 }} />
                        <p style={{ fontSize: 12, letterSpacing: '0.03em' }}>
                            {filename ? 'PDF preview not available for .txt files' : 'No file selected'}
                        </p>
                    </div>
                )}
            </div>
        </div>
    );
};

/* ─────────────────────────────────────────
   LaTeX normaliser
───────────────────────────────────────── */
function normaliseContent(text) {
    text = text.replace(/\\\[([\s\S]*?)\\\]/g, (_, i) => `\n$$${i}$$\n`);
    text = text.replace(/\\\(([\s\S]*?)\\\)/g, (_, i) => `$${i}$`);
    text = text.replace(/(\$[^$\n]+?\$)\s*\1/g, '$1');
    text = text.replace(/<br\s*\/?>/gi, ' · ');
    return text;
}

/* ─────────────────────────────────────────
   Markdown renderer — brighter text
───────────────────────────────────────── */
const MarkdownMessage = ({ content }) => (
    <ReactMarkdown
        remarkPlugins={[remarkGfm, remarkMath]}
        rehypePlugins={[rehypeRaw, [rehypeKatex, { strict: false, throwOnError: false }]]}
        components={{
            div: ({ className, children, ...props }) => {
                if (className?.includes('math-display')) return (
                    <div style={{ margin: '14px 0', padding: '14px 18px', background: '#09090c', border: '1px solid #1e1e28', borderRadius: 7, overflowX: 'auto', textAlign: 'center' }} {...props}>{children}</div>
                );
                return <div className={className} {...props}>{children}</div>;
            },
            span: ({ className, children, ...props }) => {
                if (className?.includes('math-inline')) return (
                    <span style={{ padding: '2px 6px', borderRadius: 4, background: 'rgba(200,169,110,0.12)', color: '#c8a96e', fontFamily: "'DM Mono', monospace", fontSize: '0.875em' }} {...props}>{children}</span>
                );
                return <span className={className} {...props}>{children}</span>;
            },
            table: ({ ...props }) => (
                <div style={{ overflowX: 'auto', margin: '14px 0', borderRadius: 7, border: '1px solid #1e1e26', width: '100%' }}>
                    <table style={{ borderCollapse: 'collapse', fontSize: 12.5, width: '100%', tableLayout: 'fixed', wordBreak: 'break-word', fontFamily: "'DM Mono', monospace" }} {...props} />
                </div>
            ),
            thead: ({ ...props }) => <thead style={{ background: '#111118' }} {...props} />,
            th: ({ ...props }) => <th style={{ border: 'none', borderBottom: '1px solid #1e1e26', padding: '10px 14px', textAlign: 'left', fontWeight: 500, color: '#e2e0db', fontSize: 10.5, letterSpacing: '0.07em', textTransform: 'uppercase', background: '#111118', wordBreak: 'break-word' }} {...props} />,
            td: ({ ...props }) => <td style={{ border: 'none', borderBottom: '1px solid #131318', padding: '9px 14px', color: '#b8b6b0', fontSize: 12.5, lineHeight: 1.65, background: 'transparent', wordBreak: 'break-word', verticalAlign: 'top' }} {...props} />,
            tr: ({ ...props }) => <tr style={{ transition: 'background 0.12s' }} onMouseEnter={e => e.currentTarget.style.background = 'rgba(200,169,110,0.03)'} onMouseLeave={e => e.currentTarget.style.background = 'transparent'} {...props} />,
            tbody: ({ ...props }) => <tbody {...props} />,
            code: ({ inline, children, ...props }) => inline
                ? <code style={{ background: 'rgba(200,169,110,0.1)', padding: '2px 7px', borderRadius: 4, color: '#c8a96e', fontSize: '0.84em', fontFamily: "'DM Mono', monospace" }} {...props}>{children}</code>
                : <pre style={{ background: '#09090c', border: '1px solid #1a1a22', borderRadius: 7, padding: '14px 16px', overflowX: 'auto', margin: '12px 0' }}>
                    <code style={{ color: '#b8b6b0', fontSize: '0.8em', fontFamily: "'DM Mono', monospace", lineHeight: 1.75 }} {...props}>{children}</code>
                </pre>,
            h1: ({ ...props }) => <h1 style={{ fontSize: 17, fontWeight: 300, color: '#f0ede8', margin: '18px 0 6px', fontFamily: "'Fraunces', serif", fontStyle: 'italic' }} {...props} />,
            h2: ({ ...props }) => <h2 style={{ fontSize: 14, fontWeight: 400, color: '#e2e0db', margin: '14px 0 5px', fontFamily: "'Fraunces', serif", fontStyle: 'italic' }} {...props} />,
            h3: ({ ...props }) => <h3 style={{ fontSize: 12, fontWeight: 500, color: '#c8c6c1', margin: '12px 0 4px', fontFamily: "'DM Mono', monospace", letterSpacing: '0.06em', textTransform: 'uppercase' }} {...props} />,
            ul: ({ ...props }) => <ul style={{ paddingLeft: 18, margin: '8px 0', display: 'flex', flexDirection: 'column', gap: 4 }} {...props} />,
            ol: ({ ...props }) => <ol style={{ paddingLeft: 18, margin: '8px 0', display: 'flex', flexDirection: 'column', gap: 4 }} {...props} />,
            li: ({ ...props }) => <li style={{ color: '#a8a6a0', lineHeight: 1.7, fontSize: 13 }} {...props} />,
            p: ({ ...props }) => <p style={{ margin: '0 0 10px', color: '#b8b6b0', lineHeight: 1.75, fontSize: 13 }} {...props} />,
            strong: ({ ...props }) => <strong style={{ fontWeight: 600, color: '#f0ede8' }} {...props} />,
            em: ({ ...props }) => <em style={{ fontStyle: 'italic', color: '#9898a8', fontFamily: "'Fraunces', serif" }} {...props} />,
            blockquote: ({ ...props }) => <blockquote style={{ borderLeft: '2px solid #c8a96e', margin: '12px 0', color: '#8a8a98', fontStyle: 'italic', background: 'rgba(200,169,110,0.04)', borderRadius: '0 7px 7px 0', padding: '10px 14px' }} {...props} />,
            a: ({ ...props }) => <a style={{ color: '#c8a96e', textDecoration: 'underline', textUnderlineOffset: 3 }} target="_blank" rel="noopener noreferrer" {...props} />,
            hr: ({ ...props }) => <hr style={{ border: 'none', borderTop: '1px solid #1a1a22', margin: '16px 0' }} {...props} />,
        }}
    >
        {normaliseContent(content)}
    </ReactMarkdown>
);

/* ─────────────────────────────────────────
   Think Block
───────────────────────────────────────── */
const ThinkBlock = ({ thinking, done }) => {
    const [open, setOpen] = useState(false);
    const secs = Math.max(1, Math.round(thinking.length / 200));
    return (
        <div style={{ marginBottom: 10 }}>
            <button onClick={() => setOpen(o => !o)} style={{
                display: 'flex', alignItems: 'center', gap: 6, background: 'transparent', border: 'none',
                cursor: 'pointer', padding: '3px 0', color: done ? '#7a7a8a' : '#8a7040',
                fontSize: 11, fontFamily: "'DM Mono', monospace", letterSpacing: '0.03em',
            }}>
                {!done
                    ? <Loader2 size={11} style={{ animation: 'spin 1s linear infinite', color: '#c8a96e' }} />
                    : <span style={{ fontSize: 10 }}>{open ? '▲' : '▼'}</span>}
                {done ? `Thought for ${secs}s` : 'Thinking…'}
            </button>
            {open && done && (
                <div style={{
                    marginTop: 6, padding: '10px 14px',
                    background: '#09090c', border: '1px solid #1a1a22', borderRadius: 7,
                    fontSize: 11.5, color: '#5a5a6a', fontFamily: "'DM Mono', monospace",
                    lineHeight: 1.7, whiteSpace: 'pre-wrap',
                }}>
                    {thinking}
                </div>
            )}
        </div>
    );
};

/* ─────────────────────────────────────────
   Typing dots
───────────────────────────────────────── */
const TypingDots = () => (
    <div style={{ display: 'flex', gap: 5, alignItems: 'center', padding: '5px 0' }}>
        {[0, 140, 280].map((delay, i) => (
            <span key={i} style={{
                width: 5, height: 5, borderRadius: '50%', background: '#3a3a4a',
                animation: `bounce 1.2s ease-in-out ${delay}ms infinite`, display: 'block',
            }} />
        ))}
    </div>
);

/* ─────────────────────────────────────────
   FileOption
───────────────────────────────────────── */
const FileOption = ({ name, status, selected, onSelect }) => (
    <button onClick={onSelect} style={{
        width: '100%', textAlign: 'left', padding: '8px 14px', fontSize: 12,
        display: 'flex', alignItems: 'center', gap: 8,
        background: selected ? 'rgba(200,169,110,0.08)' : 'transparent',
        color: selected ? '#c8a96e' : '#8a8a9a', border: 'none', cursor: 'pointer',
        fontFamily: "'DM Mono', monospace", letterSpacing: '0.01em', transition: 'background 0.12s',
    }}
        onMouseEnter={e => { if (!selected) { e.currentTarget.style.background = 'rgba(255,255,255,0.03)'; e.currentTarget.style.color = '#c8c6c1'; } }}
        onMouseLeave={e => { if (!selected) { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = '#8a8a9a'; } }}>
        <FileText size={11} style={{ flexShrink: 0 }} />
        <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{name}</span>
        {status === 'indexing' && <Clock size={10} style={{ color: '#8a7040', flexShrink: 0 }} />}
        {selected && status !== 'indexing' && <CheckCircle size={11} style={{ flexShrink: 0, color: '#c8a96e' }} />}
    </button>
);

/* ─────────────────────────────────────────
   Suggested Questions
───────────────────────────────────────── */
const SuggestedQuestions = ({ file, onSelect }) => {
    if (!file) return null;
    const prompts = ['Summarize this document', 'What are the key findings?', 'List all tables and figures', 'What are the main conclusions?'];
    return (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, justifyContent: 'center', maxWidth: 520 }}>
            {prompts.map(p => (
                <button key={p} onClick={() => onSelect(p)} style={{
                    padding: '7px 15px', borderRadius: 5,
                    background: 'rgba(200,169,110,0.06)', border: '1px solid rgba(200,169,110,0.18)',
                    color: '#c8a96e', fontSize: 11.5, cursor: 'pointer',
                    fontFamily: "'DM Mono', monospace", letterSpacing: '0.03em', transition: 'all 0.15s',
                }}
                    onMouseEnter={e => { e.currentTarget.style.background = 'rgba(200,169,110,0.12)'; e.currentTarget.style.borderColor = 'rgba(200,169,110,0.35)'; }}
                    onMouseLeave={e => { e.currentTarget.style.background = 'rgba(200,169,110,0.06)'; e.currentTarget.style.borderColor = 'rgba(200,169,110,0.18)'; }}>
                    {p}
                </button>
            ))}
        </div>
    );
};

/* ─────────────────────────────────────────
   Panel Tab Button
───────────────────────────────────────── */
const PanelTabBtn = ({ active, onClick, children }) => (
    <button onClick={onClick} style={{
        display: 'flex', alignItems: 'center', gap: 5,
        padding: '5px 12px', borderRadius: 5, fontSize: 11.5, cursor: 'pointer',
        fontFamily: "'DM Mono', monospace", letterSpacing: '0.03em',
        background: active ? 'rgba(200,169,110,0.1)' : 'transparent',
        border: `1px solid ${active ? 'rgba(200,169,110,0.28)' : '#1e1e26'}`,
        color: active ? '#c8a96e' : '#58586a',
        transition: 'all 0.15s',
    }}
        onMouseEnter={e => { if (!active) { e.currentTarget.style.background = '#17171e'; e.currentTarget.style.borderColor = '#2a2a36'; e.currentTarget.style.color = '#e2e0db'; } }}
        onMouseLeave={e => { if (!active) { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.borderColor = '#1e1e26'; e.currentTarget.style.color = '#58586a'; } }}>
        {children}
    </button>
);

/* ─────────────────────────────────────────
   Main Chatbot
───────────────────────────────────────── */
const Chatbot = () => {
    const [messages, setMessages] = useState([{
        id: 1, type: 'bot',
        content: 'Upload a PDF or TXT and start querying.',
        timestamp: new Date(), images: [],
    }]);
    const [inputValue, setInputValue] = useState('');
    const [isTyping, setIsTyping] = useState(false);
    const [activePanel, setActivePanel] = useState(null);
    const [files, setFiles] = useState([]);
    const [selectedFile, setSelectedFile] = useState('');
    const [uploading, setUploading] = useState(false);
    const [uploadProgress, setUploadProgress] = useState('Uploading…');
    const [showDropdown, setShowDropdown] = useState(false);
    const [showUploadPanel, setShowUploadPanel] = useState(false);
    const [showScrollBtn, setShowScrollBtn] = useState(false);
    const [userScrolled, setUserScrolled] = useState(false);

    const messagesEndRef = useRef(null);
    const scrollContainerRef = useRef(null);
    const textareaRef = useRef(null);
    const isAtBottomRef = useRef(true);

    const scrollToBottom = useCallback((behavior = 'smooth') => {
        messagesEndRef.current?.scrollIntoView({ behavior });
    }, []);

    const checkIsAtBottom = useCallback(() => {
        const el = scrollContainerRef.current;
        if (!el) return true;
        return el.scrollHeight - el.scrollTop - el.clientHeight < 80;
    }, []);

    const handleScroll = useCallback(() => {
        const atBottom = checkIsAtBottom();
        isAtBottomRef.current = atBottom;
        setShowScrollBtn(!atBottom);
        if (atBottom) setUserScrolled(false);
        else setUserScrolled(true);
    }, [checkIsAtBottom]);

    useEffect(() => { if (!userScrolled) scrollToBottom('smooth'); }, [messages, userScrolled, scrollToBottom]);
    useEffect(() => { if (isTyping && isAtBottomRef.current) scrollToBottom('auto'); }, [messages, isTyping, scrollToBottom]);
    useEffect(() => {
        if (textareaRef.current) {
            textareaRef.current.style.height = 'auto';
            textareaRef.current.style.height = `${Math.min(textareaRef.current.scrollHeight, 160)}px`;
        }
    }, [inputValue]);
    useEffect(() => { fetchFiles(); }, []);

    useEffect(() => {
        const indexingFiles = files.filter(f => f.status === 'indexing');
        if (indexingFiles.length === 0) return;
        const interval = setInterval(async () => {
            let anyChange = false;
            const updated = await Promise.all(files.map(async f => {
                if (f.status !== 'indexing') return f;
                try {
                    const res = await axios.get(`${API}/status/${encodeURIComponent(f.name)}`);
                    if (res.data.status !== f.status) anyChange = true;
                    return { ...f, status: res.data.status };
                } catch { return f; }
            }));
            if (anyChange) setFiles(updated);
        }, 3000);
        return () => clearInterval(interval);
    }, [files]);

    const fetchFiles = async () => {
        try {
            const res = await axios.get(`${API}/files`);
            const raw = res.data.files || [];
            const list = raw.map(f => typeof f === 'string' ? { name: f, status: 'ready' } : { name: f.name, status: f.status || 'ready' });
            setFiles(list);
            if (list.length > 0 && !selectedFile) setSelectedFile(list[0].name);
        } catch (e) { console.error('Failed to fetch files:', e); }
    };

    const handleReindex = async (filename) => {
        try {
            await axios.post(`${API}/reindex`, { filename });
            setFiles(prev => prev.map(f => f.name === filename ? { ...f, status: 'indexing' } : f));
            setMessages(prev => [...prev, { id: Date.now(), type: 'bot', content: `Re-indexing **"${filename}"** started.`, timestamp: new Date(), images: [] }]);
        } catch (err) {
            setMessages(prev => [...prev, { id: Date.now(), type: 'bot', content: `Re-index failed: ${err.response?.data?.error || err.message}`, timestamp: new Date(), images: [] }]);
        }
    };

    const handleUploadFile = async (file) => {
        if (!file) return;
        const ext = '.' + file.name.split('.').pop().toLowerCase();
        if (!['.pdf', '.txt'].includes(ext)) { alert('Only PDF and TXT files are supported.'); return; }
        setUploading(true);
        setUploadProgress('Uploading file…');
        const formData = new FormData();
        formData.append('file', file);
        try {
            const progressTimer = setTimeout(() => setUploadProgress('Indexing document…'), 1500);
            const res = await axios.post(`${API}/upload`, formData, { headers: { 'Content-Type': 'multipart/form-data' } });
            clearTimeout(progressTimer);
            const uploaded = res.data.file;
            await fetchFiles();
            setSelectedFile(uploaded);
            setShowUploadPanel(false);
            setMessages(prev => [...prev, { id: Date.now(), type: 'bot', content: `**"${uploaded}"** uploaded and indexed. You can now query it.`, timestamp: new Date(), images: [] }]);
        } catch (err) {
            setMessages(prev => [...prev, { id: Date.now(), type: 'bot', content: `Upload failed: ${err.response?.data?.error || err.message}`, timestamp: new Date(), images: [] }]);
        } finally {
            setUploading(false);
            setUploadProgress('Uploading…');
        }
    };

    const handleSend = async (overrideText) => {
        const text = overrideText || inputValue;
        if (!text.trim()) return;
        if (!selectedFile) {
            setMessages(prev => [...prev, { id: Date.now(), type: 'bot', content: 'Please upload or select a file first.', timestamp: new Date(), images: [] }]);
            return;
        }
        const userMsg = { id: Date.now(), type: 'user', content: text, timestamp: new Date() };
        setMessages(prev => [...prev, userMsg]);
        setInputValue('');
        setIsTyping(true);
        setUserScrolled(false);
        isAtBottomRef.current = true;

        const botId = Date.now() + 1;
        setMessages(prev => [...prev, { id: botId, type: 'bot', content: '', timestamp: new Date(), images: [], thinking: '', thinkDone: false }]);

        try {
            const response = await fetch(`${API}/generate`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ prompt: userMsg.content, filename: selectedFile, temperature: 0.4, max_output_tokens: 1024, top_p: 0.9 })
            });

            const contentType = response.headers.get('content-type') || '';
            if (contentType.includes('application/json')) {
                const data = await response.json();
                setMessages(prev => prev.map(msg => msg.id === botId ? { ...msg, content: data.response || '' } : msg));
                return;
            }

            const tokenQueue = [];
            const DRIP_INTERVAL = 18;
            const CHARS_PER_TICK = 2;
            const drip = setInterval(() => {
                if (tokenQueue.length === 0) return;
                const chunk = tokenQueue.splice(0, CHARS_PER_TICK).join('');
                setMessages(prev => prev.map(msg => msg.id === botId ? { ...msg, content: msg.content + chunk } : msg));
                if (isAtBottomRef.current) scrollToBottom('auto');
            }, DRIP_INTERVAL);

            const reader = response.body.getReader();
            const decoder = new TextDecoder();
            let buffer = '';

            while (true) {
                const { done, value } = await reader.read();
                if (done) break;
                buffer += decoder.decode(value, { stream: true });
                const lines = buffer.split('\n');
                buffer = lines.pop();

                for (const line of lines) {
                    if (!line.startsWith('data: ')) continue;
                    const data = line.slice(6).trim();
                    if (data === '[DONE]') break;
                    try {
                        const json = JSON.parse(data);
                        if (json.images) { setMessages(prev => prev.map(msg => msg.id === botId ? { ...msg, images: json.images } : msg)); continue; }
                        if (json.think_token) { setMessages(prev => prev.map(msg => msg.id === botId ? { ...msg, thinking: (msg.thinking || '') + json.think_token } : msg)); continue; }
                        if (json.think_end) { setMessages(prev => prev.map(msg => msg.id === botId ? { ...msg, thinkDone: true } : msg)); continue; }
                        const token = json.token || '';
                        if (token) tokenQueue.push(...token.split(''));
                    } catch { }
                }
            }

            await new Promise(resolve => {
                const drain = setInterval(() => {
                    if (tokenQueue.length === 0) { clearInterval(drain); resolve(); return; }
                    const chunk = tokenQueue.splice(0, CHARS_PER_TICK).join('');
                    setMessages(prev => prev.map(msg => msg.id === botId ? { ...msg, content: msg.content + chunk } : msg));
                    if (isAtBottomRef.current) scrollToBottom('auto');
                }, DRIP_INTERVAL);
            });
            clearInterval(drip);
        } catch (error) {
            setMessages(prev => prev.map(msg => msg.id === botId ? { ...msg, content: `Error: ${error.message}` } : msg));
        } finally {
            setIsTyping(false);
        }
    };

    const handleKeyDown = (e) => {
        if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSend(); }
    };

    const togglePanel = (panel) => {
        setActivePanel(prev => prev === panel ? null : panel);
    };

    const isEmpty = files.length === 0 && messages.length <= 1;
    const hasFileButEmpty = files.length > 0 && messages.length <= 1;
    const panelOpen = activePanel !== null;

    return (
        <>
            <link rel="preconnect" href="https://fonts.googleapis.com" />
            <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="" />
            <link href="https://fonts.googleapis.com/css2?family=Fraunces:ital,opsz,wght@0,9..144,300;0,9..144,500;1,9..144,300&family=DM+Mono:wght@300;400;500&display=swap" rel="stylesheet" />

            <style>{`
                * { box-sizing: border-box; margin: 0; padding: 0; }
                ::-webkit-scrollbar { width: 4px; height: 4px; }
                ::-webkit-scrollbar-track { background: transparent; }
                ::-webkit-scrollbar-thumb { background: #1e1e28; border-radius: 99px; }
                ::-webkit-scrollbar-thumb:hover { background: #2e2e3e; }
                @keyframes spin { to { transform: rotate(360deg); } }
                @keyframes bounce { 0%,80%,100% { transform:translateY(0);opacity:0.3; } 40% { transform:translateY(-4px);opacity:1; } }
                @keyframes shimmer { 0% { opacity:0.4; } 50% { opacity:1; } 100% { opacity:0.4; } }
                @keyframes modalIn { from { opacity:0;transform:scale(0.96) translateY(8px); } to { opacity:1;transform:scale(1) translateY(0); } }
                @keyframes fadeSlideUp { from { opacity:0;transform:translateY(10px); } to { opacity:1;transform:translateY(0); } }
                @keyframes fadeIn { from { opacity:0; } to { opacity:1; } }
                @keyframes scrollBtnIn { from { opacity:0;transform:translateX(-50%) translateY(8px); } to { opacity:1;transform:translateX(-50%) translateY(0); } }
                .cb-msg-bot { animation: fadeSlideUp 0.22s ease forwards; }
                .cb-msg-user { animation: fadeSlideUp 0.16s ease forwards; }
                .cb-send-btn:not(:disabled):hover { background: #d4b880 !important; }
                .cb-send-btn:not(:disabled):active { transform: scale(0.92); }
                .cb-input-area:focus-within { border-color: rgba(200,169,110,0.38) !important; box-shadow: 0 0 0 3px rgba(200,169,110,0.06) !important; }
                .cb-topbar-btn:hover { background: #17171e !important; color: #e2e0db !important; border-color: #2a2a36 !important; }
            `}</style>

            <div style={{
                position: 'relative', display: 'flex', flexDirection: 'column',
                height: '100vh', background: '#0d0d10',
                fontFamily: "'DM Mono', monospace", color: '#e2e0db', overflow: 'hidden',
            }}>
                {showUploadPanel && (
                    <UploadPanel
                        onUpload={handleUploadFile} uploading={uploading} uploadProgress={uploadProgress}
                        onClose={() => setShowUploadPanel(false)} files={files}
                        selectedFile={selectedFile} onSelectFile={setSelectedFile} onReindex={handleReindex}
                    />
                )}

                {/* ── Top Bar ── */}
                <div style={{
                    borderBottom: '1px solid #181820', padding: '0 16px', height: 52,
                    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                    flexShrink: 0, background: '#0d0d10', position: 'sticky', top: 0, zIndex: 100,
                }}>
                    {/* Brand */}
                    <div style={{ display: 'flex', alignItems: 'center', gap: 9 }}>
                        <span style={{ color: '#c8a96e', fontSize: 17, lineHeight: 1 }}>◈</span>
                        <span style={{ fontSize: 14, fontWeight: 500, color: '#f0ede8', fontFamily: "'Fraunces', serif", letterSpacing: '0.01em' }}>
                            CMTI Bot
                        </span>
                    </div>

                    {/* Right controls */}
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                        {/* New Chat */}
                        <button className="cb-topbar-btn" onClick={() => {
                            setMessages([{ id: 1, type: 'bot', content: 'Upload a PDF or TXT and start querying.', timestamp: new Date(), images: [] }]);
                            setInputValue(''); setUserScrolled(false);
                        }} style={{
                            display: 'flex', alignItems: 'center', gap: 5,
                            background: 'transparent', border: '1px solid #1e1e26',
                            color: '#78788a', padding: '5px 11px', borderRadius: 5,
                            fontSize: 11.5, cursor: 'pointer', fontFamily: "'DM Mono', monospace", transition: 'all 0.15s',
                        }}>
                            <Plus size={11} />New chat
                        </button>

                        {selectedFile && (
                            <>
                                <PanelTabBtn active={activePanel === 'pdf'} onClick={() => togglePanel('pdf')}>
                                    <FileSearch size={11} />PDF
                                </PanelTabBtn>
                                <PanelTabBtn active={activePanel === 'report'} onClick={() => togglePanel('report')}>
                                    <FileText size={11} />Report
                                </PanelTabBtn>
                            </>
                        )}

                        {/* Upload */}
                        <button onClick={() => setShowUploadPanel(true)} disabled={uploading} style={{
                            display: 'flex', alignItems: 'center', gap: 5,
                            background: uploading ? 'transparent' : 'rgba(200,169,110,0.08)',
                            border: `1px solid ${uploading ? '#1e1e26' : 'rgba(200,169,110,0.25)'}`,
                            color: uploading ? '#48485a' : '#c8a96e',
                            padding: '5px 11px', borderRadius: 5,
                            fontSize: 11.5, cursor: uploading ? 'wait' : 'pointer',
                            opacity: uploading ? 0.6 : 1, fontFamily: "'DM Mono', monospace", transition: 'all 0.15s',
                        }}
                            onMouseEnter={e => { if (!uploading) { e.currentTarget.style.background = 'rgba(200,169,110,0.14)'; } }}
                            onMouseLeave={e => { if (!uploading) e.currentTarget.style.background = 'rgba(200,169,110,0.08)'; }}>
                            {uploading ? <Loader2 size={11} style={{ animation: 'spin 1s linear infinite' }} /> : <Upload size={11} />}
                            {uploading ? 'Indexing…' : 'Upload'}
                        </button>

                        {/* File selector dropdown */}
                        <div style={{ position: 'relative' }}>
                            {showDropdown && <div style={{ position: 'fixed', inset: 0, zIndex: 1 }} onClick={() => setShowDropdown(false)} />}
                            <button onClick={() => setShowDropdown(p => !p)} style={{
                                position: 'relative', zIndex: 3,
                                display: 'flex', alignItems: 'center', gap: 7,
                                background: showDropdown ? '#17171e' : 'transparent',
                                border: `1px solid ${showDropdown ? '#2a2a38' : '#1e1e26'}`,
                                color: '#c8c6c1', padding: '5px 11px', borderRadius: 5,
                                fontSize: 11.5, cursor: 'pointer', fontFamily: "'DM Mono', monospace",
                                maxWidth: 210, transition: 'all 0.15s',
                            }}>
                                <span style={{ width: 5, height: 5, borderRadius: '50%', background: '#c8a96e', flexShrink: 0 }} />
                                <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1, maxWidth: 140 }}>
                                    {selectedFile || 'No file'}
                                </span>
                                {files.find(f => f.name === selectedFile)?.status === 'indexing' && (
                                    <Clock size={9} style={{ color: '#8a7040', flexShrink: 0 }} />
                                )}
                                <ChevronDown size={10} style={{ color: '#58586a', flexShrink: 0, transform: showDropdown ? 'rotate(180deg)' : 'rotate(0)', transition: 'transform 0.2s' }} />
                            </button>

                            {showDropdown && (
                                <div style={{
                                    position: 'absolute', right: 0, top: 'calc(100% + 7px)',
                                    width: 270, background: '#0d0d10',
                                    border: '1px solid #1e1e26', borderRadius: 8,
                                    boxShadow: '0 20px 60px rgba(0,0,0,0.75)', zIndex: 2,
                                    overflow: 'hidden', animation: 'fadeIn 0.14s ease',
                                }}>
                                    {files.length === 0
                                        ? <p style={{ color: '#48485a', fontSize: 12, padding: '12px 16px' }}>No files indexed yet</p>
                                        : files.map(f => (
                                            <FileOption key={f.name} name={f.name} status={f.status}
                                                selected={selectedFile === f.name}
                                                onSelect={() => { setSelectedFile(f.name); setShowDropdown(false); }} />
                                        ))}
                                </div>
                            )}
                        </div>
                    </div>
                </div>

                {/* ── Main split area ── */}
                <div style={{ flex: 1, display: 'flex', overflow: 'hidden', position: 'relative' }}>

                    {/* ── Chat pane ── */}
                    <div style={{
                        display: 'flex', flexDirection: 'column',
                        flex: panelOpen ? '0 0 50%' : '1',
                        minWidth: 0, overflow: 'hidden',
                        transition: 'flex 0.3s cubic-bezier(0.4,0,0.2,1)',
                        borderRight: panelOpen ? '1px solid #181820' : 'none',
                    }}>
                        {/* Empty / welcome state */}
                        {(isEmpty || hasFileButEmpty) && (
                            <div style={{
                                flex: 1, display: 'flex', flexDirection: 'column',
                                alignItems: 'center', justifyContent: 'center',
                                gap: 20, padding: '0 24px', animation: 'fadeSlideUp 0.35s ease',
                            }}>
                                <div style={{ fontSize: 30, color: '#252530', lineHeight: 1 }}>∴</div>
                                <div style={{ textAlign: 'center' }}>
                                    <p style={{ fontSize: 15, fontWeight: 300, color: '#58586a', fontFamily: "'Fraunces', serif", fontStyle: 'italic' }}>
                                        {isEmpty ? 'No documents loaded' : `Query · ${selectedFile}`}
                                    </p>
                                    <p style={{ fontSize: 11.5, color: '#38384a', marginTop: 6, letterSpacing: '0.03em' }}>
                                        {isEmpty ? 'Upload a PDF or TXT to begin' : 'Type a question or select a prompt below'}
                                    </p>
                                </div>
                                {isEmpty ? (
                                    <button onClick={() => setShowUploadPanel(true)} style={{
                                        display: 'flex', alignItems: 'center', gap: 8,
                                        background: '#c8a96e', color: '#09090c', padding: '9px 20px',
                                        borderRadius: 5, fontSize: 12, fontWeight: 600, border: 'none',
                                        cursor: 'pointer', fontFamily: "'DM Mono', monospace", letterSpacing: '0.04em', transition: 'background 0.15s',
                                    }}
                                        onMouseEnter={e => e.currentTarget.style.background = '#d4b880'}
                                        onMouseLeave={e => e.currentTarget.style.background = '#c8a96e'}>
                                        <Upload size={13} />Upload a document
                                    </button>
                                ) : (
                                    <SuggestedQuestions file={selectedFile} onSelect={t => handleSend(t)} />
                                )}
                            </div>
                        )}

                        {/* Messages */}
                        {!isEmpty && !hasFileButEmpty && (
                            <div ref={scrollContainerRef} onScroll={handleScroll} style={{
                                flex: 1, overflowY: 'auto', padding: '28px 24px 20px',
                                display: 'flex', flexDirection: 'column', position: 'relative',
                            }}>
                                <div style={{ maxWidth: 700, width: '100%', margin: '0 auto', display: 'flex', flexDirection: 'column', gap: 24 }}>
                                    {messages.map((msg, idx) => (
                                        <div key={msg.id} className={msg.type === 'user' ? 'cb-msg-user' : 'cb-msg-bot'}
                                            style={{
                                                display: 'flex', justifyContent: msg.type === 'user' ? 'flex-end' : 'flex-start',
                                                animationDelay: `${Math.min(idx * 0.03, 0.18)}s`, animationFillMode: 'both',
                                            }}>
                                            {msg.type === 'user' ? (
                                                <div style={{
                                                    maxWidth: '72%', background: '#17171e',
                                                    border: '1px solid rgba(200,169,110,0.2)',
                                                    color: '#e2e0db', padding: '11px 16px',
                                                    borderRadius: '9px 9px 3px 9px',
                                                    fontSize: 13, lineHeight: 1.65,
                                                    fontFamily: "'DM Mono', monospace",
                                                }}>
                                                    {msg.content}
                                                </div>
                                            ) : (
                                                <div style={{ display: 'flex', gap: 12, maxWidth: '100%', alignItems: 'flex-start', width: '100%' }}>
                                                    <div style={{
                                                        width: 28, height: 28, borderRadius: 7, flexShrink: 0,
                                                        background: '#17171e', border: '1px solid rgba(200,169,110,0.2)',
                                                        display: 'flex', alignItems: 'center', justifyContent: 'center', marginTop: 2,
                                                    }}>
                                                        <span style={{ color: '#c8a96e', fontSize: 13 }}>◈</span>
                                                    </div>
                                                    <div style={{ flex: 1, minWidth: 0, overflowX: 'hidden', paddingTop: 3 }}>
                                                        {msg.thinking && <ThinkBlock thinking={msg.thinking} done={msg.thinkDone} />}
                                                        {msg.content
                                                            ? <MarkdownMessage content={msg.content} />
                                                            : isTyping && idx === messages.length - 1 ? <TypingDots /> : null}
                                                    </div>
                                                </div>
                                            )}
                                        </div>
                                    ))}
                                    <div ref={messagesEndRef} style={{ height: 1 }} />
                                </div>

                                {showScrollBtn && (
                                    <button onClick={() => { setUserScrolled(false); scrollToBottom('smooth'); }} style={{
                                        position: 'sticky', bottom: 8, left: '50%', transform: 'translateX(-50%)',
                                        display: 'flex', alignItems: 'center', gap: 5,
                                        background: '#13131a', border: '1px solid #1e1e28',
                                        color: '#8a8a9a', padding: '6px 14px', borderRadius: 5,
                                        fontSize: 11.5, cursor: 'pointer', fontFamily: "'DM Mono', monospace",
                                        boxShadow: '0 4px 24px rgba(0,0,0,0.6)',
                                        animation: 'scrollBtnIn 0.2s cubic-bezier(0.34,1.56,0.64,1)',
                                        whiteSpace: 'nowrap', width: 'fit-content',
                                        marginLeft: 'auto', marginRight: 'auto',
                                    }}>
                                        <ArrowDown size={11} />Scroll to bottom
                                    </button>
                                )}
                            </div>
                        )}

                        {/* ── Input Bar ── */}
                        <div style={{
                            borderTop: '1px solid #181820', padding: '10px 16px 14px',
                            flexShrink: 0, background: '#0d0d10',
                        }}>
                            {selectedFile && (
                                <div style={{ maxWidth: 700, margin: '0 auto 8px' }}>
                                    <span onClick={() => setShowUploadPanel(true)} style={{
                                        display: 'inline-flex', alignItems: 'center', gap: 6,
                                        background: 'rgba(200,169,110,0.06)', border: '1px solid rgba(200,169,110,0.16)',
                                        color: '#c8a96e', fontSize: 10.5, padding: '3px 10px', borderRadius: 5,
                                        cursor: 'pointer', fontFamily: "'DM Mono', monospace", letterSpacing: '0.04em',
                                        transition: 'all 0.15s',
                                    }}>
                                        <span style={{ width: 4, height: 4, borderRadius: '50%', background: '#c8a96e' }} />
                                        {selectedFile}
                                        {files.find(f => f.name === selectedFile)?.status === 'indexing' && (
                                            <span style={{ display: 'flex', alignItems: 'center', gap: 3, color: '#8a7040' }}>
                                                <Clock size={8} />indexing…
                                            </span>
                                        )}
                                    </span>
                                </div>
                            )}

                            <div style={{ maxWidth: 700, margin: '0 auto' }}>
                                <div className="cb-input-area" style={{
                                    display: 'flex', alignItems: 'flex-end', gap: 8,
                                    background: '#111118', border: '1px solid #1e1e28',
                                    borderRadius: 9, padding: '8px 8px 8px 13px',
                                    transition: 'border-color 0.2s, box-shadow 0.2s',
                                }}>
                                    <button onClick={() => setShowUploadPanel(true)} disabled={uploading} style={{
                                        padding: 7, borderRadius: 5, background: 'transparent', border: 'none',
                                        cursor: uploading ? 'wait' : 'pointer', color: '#48485a', flexShrink: 0,
                                        opacity: uploading ? 0.5 : 1, display: 'flex', transition: 'color 0.15s', marginBottom: 1,
                                    }}
                                        onMouseEnter={e => { if (!uploading) e.currentTarget.style.color = '#c8a96e'; }}
                                        onMouseLeave={e => e.currentTarget.style.color = '#48485a'}>
                                        {uploading ? <Loader2 size={15} style={{ color: '#c8a96e', animation: 'spin 1s linear infinite' }} /> : <Paperclip size={15} />}
                                    </button>

                                    <textarea ref={textareaRef} value={inputValue}
                                        onChange={e => setInputValue(e.target.value)} onKeyDown={handleKeyDown}
                                        placeholder={!selectedFile ? 'Upload a file to start…' : `Ask about ${selectedFile}…`}
                                        rows={1} style={{
                                            flex: 1, background: 'transparent', border: 'none', outline: 'none',
                                            resize: 'none', color: '#e2e0db', fontSize: 13, lineHeight: 1.6,
                                            fontFamily: "'DM Mono', monospace", padding: '5px 0',
                                            maxHeight: 160, overflowY: 'auto',
                                        }} />

                                    <button className="cb-send-btn" onClick={() => handleSend()}
                                        disabled={!inputValue.trim() || !selectedFile || uploading} style={{
                                            width: 33, height: 33, borderRadius: 7, flexShrink: 0,
                                            background: inputValue.trim() && selectedFile && !uploading ? '#c8a96e' : '#17171e',
                                            border: `1px solid ${inputValue.trim() && selectedFile && !uploading ? '#c8a96e' : '#1e1e28'}`,
                                            cursor: inputValue.trim() && selectedFile && !uploading ? 'pointer' : 'not-allowed',
                                            display: 'flex', alignItems: 'center', justifyContent: 'center',
                                            color: inputValue.trim() && selectedFile && !uploading ? '#09090c' : '#2e2e3e',
                                            transition: 'all 0.15s', marginBottom: 1,
                                        }}>
                                        <Send size={13} />
                                    </button>
                                </div>

                                <p style={{ fontSize: 10.5, color: '#252535', textAlign: 'center', marginTop: 7, letterSpacing: '0.04em', textTransform: 'uppercase' }}>
                                    Answers grounded in selected document only
                                </p>
                            </div>
                        </div>
                    </div>

                    {/* ── Right Panel (PDF or Report) ── */}
                    {panelOpen && (
                        <div style={{
                            flex: '0 0 50%', minWidth: 0, overflow: 'hidden',
                            display: 'flex', flexDirection: 'column',
                            animation: 'fadeIn 0.2s ease',
                            background: '#09090c',
                        }}>
                            {/* Panel sub-tabs */}
                            <div style={{
                                display: 'flex', alignItems: 'center', gap: 4,
                                padding: '0 12px', height: 48, flexShrink: 0,
                                borderBottom: '1px solid #181820', background: '#0d0d10',
                            }}>
                                <button onClick={() => setActivePanel('pdf')} style={{
                                    display: 'flex', alignItems: 'center', gap: 5,
                                    padding: '5px 12px', borderRadius: 5, fontSize: 11.5,
                                    cursor: 'pointer', fontFamily: "'DM Mono', monospace",
                                    background: activePanel === 'pdf' ? 'rgba(200,169,110,0.1)' : 'transparent',
                                    border: `1px solid ${activePanel === 'pdf' ? 'rgba(200,169,110,0.28)' : 'transparent'}`,
                                    color: activePanel === 'pdf' ? '#c8a96e' : '#58586a',
                                    transition: 'all 0.15s',
                                }}>
                                    <FileSearch size={11} />PDF Viewer
                                </button>
                                <button onClick={() => setActivePanel('report')} style={{
                                    display: 'flex', alignItems: 'center', gap: 5,
                                    padding: '5px 12px', borderRadius: 5, fontSize: 11.5,
                                    cursor: 'pointer', fontFamily: "'DM Mono', monospace",
                                    background: activePanel === 'report' ? 'rgba(200,169,110,0.1)' : 'transparent',
                                    border: `1px solid ${activePanel === 'report' ? 'rgba(200,169,110,0.28)' : 'transparent'}`,
                                    color: activePanel === 'report' ? '#c8a96e' : '#58586a',
                                    transition: 'all 0.15s',
                                }}>
                                    <FileText size={11} />Report
                                </button>
                                <div style={{ flex: 1 }} />
                                <button onClick={() => setActivePanel(null)} style={{
                                    padding: 6, borderRadius: 5, background: 'transparent',
                                    border: '1px solid #1a1a24', cursor: 'pointer', color: '#48485a',
                                    display: 'flex', transition: 'all 0.15s',
                                }}
                                    onMouseEnter={e => { e.currentTarget.style.color = '#e2e0db'; e.currentTarget.style.borderColor = '#3a3a4a'; }}
                                    onMouseLeave={e => { e.currentTarget.style.color = '#48485a'; e.currentTarget.style.borderColor = '#1a1a24'; }}>
                                    <X size={12} />
                                </button>
                            </div>

                            <div style={{ flex: 1, overflow: 'hidden' }}>
                                {activePanel === 'pdf' && (
                                    <PdfViewerPanel filename={selectedFile} apiBase={API} onClose={() => setActivePanel(null)} />
                                )}
                                {activePanel === 'report' && (
                                    <div style={{ height: '100%', overflowY: 'auto' }}>
                                        <ReportPanel filename={selectedFile} apiBase={API} />
                                    </div>
                                )}
                            </div>
                        </div>
                    )}
                </div>
            </div>
        </>
    );
};

export default Chatbot;