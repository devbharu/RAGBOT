import React, { useState, useRef, useEffect, useCallback } from 'react';
import {
    Send, Paperclip, FileText, ChevronDown,
    Upload, X, FileUp, CheckCircle, Loader2,
    ArrowDown, Plus, Sparkles, Image, ChevronLeft,
    ChevronRight, LayoutGrid, RefreshCw, Clock, Zap
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
                position: 'relative',
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                justifyContent: 'center',
                gap: '14px',
                border: `1.5px dashed ${dragging ? '#6366f1' : '#2e2e38'}`,
                borderRadius: '14px',
                padding: '36px 24px',
                cursor: uploading ? 'wait' : 'pointer',
                transition: 'all 0.2s ease',
                background: dragging ? 'rgba(99,102,241,0.06)' : 'rgba(18,18,24,0.6)',
                opacity: uploading ? 0.85 : 1,
                pointerEvents: uploading ? 'none' : 'auto',
            }}
        >
            <input
                ref={inputRef} type="file" accept=".pdf,.txt"
                onChange={(e) => { const f = e.target.files[0]; if (f) onUpload(f); e.target.value = ''; }}
                style={{ display: 'none' }}
            />
            <div style={{
                width: 48, height: 48, borderRadius: 12,
                background: dragging ? 'rgba(99,102,241,0.18)' : 'rgba(40,40,52,0.9)',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                transition: 'all 0.2s',
                border: `1px solid ${dragging ? 'rgba(99,102,241,0.4)' : '#2e2e38'}`,
            }}>
                {uploading
                    ? <Loader2 size={22} style={{ color: '#6366f1', animation: 'spin 1s linear infinite' }} />
                    : <FileUp size={22} style={{ color: dragging ? '#818cf8' : '#52525b' }} />
                }
            </div>
            <div style={{ textAlign: 'center' }}>
                <p style={{ fontSize: 13.5, fontWeight: 500, color: '#e4e4e7', margin: 0, letterSpacing: '-0.01em' }}>
                    {uploading ? uploadProgress : dragging ? 'Drop to upload' : 'Drop file here'}
                </p>
                <p style={{ fontSize: 12, color: '#52525b', marginTop: 3 }}>
                    {uploading ? 'Processing… this may take a moment' : 'click to browse · PDF & TXT supported'}
                </p>
            </div>
            {uploading && (
                <div style={{ width: '100%', height: 2, background: '#1e1e2a', borderRadius: 99, overflow: 'hidden' }}>
                    <div style={{ height: '100%', background: 'linear-gradient(90deg,#6366f1,#818cf8)', borderRadius: 99, animation: 'shimmer 1.5s ease-in-out infinite', width: '100%' }} />
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
            position: 'absolute', inset: 0, zIndex: 50,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            background: 'rgba(0,0,0,0.75)', backdropFilter: 'blur(10px)',
        }}
        onClick={() => !uploading && onClose()}
    >
        <div
            style={{
                position: 'relative', width: '100%', maxWidth: 420,
                margin: '0 16px',
                background: '#111118',
                border: '1px solid #1f1f2e',
                borderRadius: 20, padding: 22,
                display: 'flex', flexDirection: 'column', gap: 18,
                boxShadow: '0 32px 80px rgba(0,0,0,0.7)',
                animation: 'modalIn 0.22s cubic-bezier(0.34,1.56,0.64,1)',
            }}
            onClick={e => e.stopPropagation()}
        >
            <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between' }}>
                <div>
                    <h2 style={{ fontSize: 14, fontWeight: 600, color: '#f4f4f5', margin: 0, letterSpacing: '-0.02em' }}>Upload Document</h2>
                    <p style={{ fontSize: 11.5, color: '#42424e', marginTop: 3, letterSpacing: '0.01em' }}>PDF or TXT · indexed automatically</p>
                </div>
                {!uploading && (
                    <button onClick={onClose} style={{
                        padding: 6, borderRadius: 9, background: 'transparent',
                        border: 'none', cursor: 'pointer', color: '#52525b',
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                        transition: 'all 0.15s',
                    }}
                        onMouseEnter={e => { e.currentTarget.style.background = '#1e1e2a'; e.currentTarget.style.color = '#e4e4e7'; }}
                        onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = '#52525b'; }}
                    >
                        <X size={15} />
                    </button>
                )}
            </div>

            <UploadZone onUpload={onUpload} uploading={uploading} uploadProgress={uploadProgress} />

            {!uploading && files.length > 0 && (
                <div>
                    <p style={{ fontSize: 10.5, color: '#42424e', fontWeight: 600, letterSpacing: '0.09em', textTransform: 'uppercase', marginBottom: 8 }}>
                        Indexed documents
                    </p>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 3, maxHeight: 200, overflowY: 'auto' }}>
                        {files.map(f => (
                            <div
                                key={f.name}
                                style={{
                                    display: 'flex', alignItems: 'center', gap: 8,
                                    padding: '7px 10px', borderRadius: 10,
                                    background: selectedFile === f.name ? 'rgba(99,102,241,0.12)' : 'transparent',
                                    border: `1px solid ${selectedFile === f.name ? 'rgba(99,102,241,0.25)' : 'transparent'}`,
                                    transition: 'all 0.15s',
                                }}
                            >
                                <button
                                    onClick={() => { onSelectFile(f.name); onClose(); }}
                                    style={{
                                        display: 'flex', alignItems: 'center', gap: 8,
                                        flex: 1, textAlign: 'left',
                                        background: 'transparent', border: 'none',
                                        cursor: 'pointer', fontSize: 12.5,
                                        color: selectedFile === f.name ? '#818cf8' : '#a1a1aa',
                                        fontFamily: 'inherit',
                                    }}
                                >
                                    <FileText size={12} style={{ flexShrink: 0 }} />
                                    <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{f.name}</span>
                                    {f.status === 'indexing' && (
                                        <span style={{ fontSize: 10, color: '#f59e0b', display: 'flex', alignItems: 'center', gap: 3, flexShrink: 0 }}>
                                            <Clock size={10} />indexing
                                        </span>
                                    )}
                                    {f.status === 'ready' && selectedFile === f.name && <CheckCircle size={12} style={{ flexShrink: 0, color: '#6366f1' }} />}
                                </button>
                                <button
                                    onClick={(e) => { e.stopPropagation(); onReindex(f.name); }}
                                    title="Re-index file"
                                    style={{
                                        padding: 5, borderRadius: 7, background: 'transparent',
                                        border: 'none', cursor: 'pointer', color: '#42424e',
                                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                                        transition: 'all 0.15s', flexShrink: 0,
                                    }}
                                    onMouseEnter={e => { e.currentTarget.style.background = '#1e1e2a'; e.currentTarget.style.color = '#a1a1aa'; }}
                                    onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = '#42424e'; }}
                                >
                                    <RefreshCw size={11} />
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
   Page Image Viewer
───────────────────────────────────────── */
const PageImageViewer = ({ images, filename, onClose }) => {
    const [current, setCurrent] = useState(0);
    const [loaded, setLoaded] = useState({});
    const [errors, setErrors] = useState({});

    const prev = () => setCurrent(i => Math.max(0, i - 1));
    const next = () => setCurrent(i => Math.min(images.length - 1, i + 1));

    useEffect(() => {
        const handler = (e) => {
            if (e.key === 'Escape') onClose();
            if (e.key === 'ArrowLeft') prev();
            if (e.key === 'ArrowRight') next();
        };
        window.addEventListener('keydown', handler);
        return () => window.removeEventListener('keydown', handler);
    }, [onClose]);

    if (!images || images.length === 0) return null;

    return (
        <div
            style={{
                position: 'fixed', inset: 0, zIndex: 200,
                background: 'rgba(0,0,0,0.94)', backdropFilter: 'blur(14px)',
                display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
            }}
            onClick={onClose}
        >
            <div
                style={{
                    position: 'relative', maxWidth: '90vw', maxHeight: '88vh',
                    display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 12,
                    animation: 'modalIn 0.2s cubic-bezier(0.34,1.56,0.64,1)',
                }}
                onClick={e => e.stopPropagation()}
            >
                <div style={{ display: 'flex', alignItems: 'center', gap: 12, width: '100%', justifyContent: 'space-between' }}>
                    <span style={{ fontSize: 12, color: '#52525b', fontWeight: 500 }}>
                        {filename} · Page {images[current]?.page}
                        {images.length > 1 && <span style={{ color: '#3a3a45' }}> ({current + 1}/{images.length})</span>}
                    </span>
                    <button
                        onClick={onClose}
                        style={{ padding: 6, borderRadius: 9, background: '#1e1e2a', border: 'none', cursor: 'pointer', color: '#a1a1aa', display: 'flex' }}
                        onMouseEnter={e => { e.currentTarget.style.background = '#2a2a38'; e.currentTarget.style.color = '#f4f4f5'; }}
                        onMouseLeave={e => { e.currentTarget.style.background = '#1e1e2a'; e.currentTarget.style.color = '#a1a1aa'; }}
                    >
                        <X size={14} />
                    </button>
                </div>

                <div style={{
                    position: 'relative', borderRadius: 12, overflow: 'hidden',
                    background: '#0d0d12', border: '1px solid #1e1e2a',
                    maxHeight: '75vh', display: 'flex', alignItems: 'center', justifyContent: 'center',
                    minWidth: 200, minHeight: 150,
                }}>
                    {!loaded[current] && !errors[current] && (
                        <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                            <Loader2 size={24} style={{ color: '#3a3a45', animation: 'spin 1s linear infinite' }} />
                        </div>
                    )}
                    {errors[current] ? (
                        <div style={{ padding: '24px 32px', color: '#52525b', fontSize: 13, textAlign: 'center' }}>
                            <Image size={24} style={{ display: 'block', margin: '0 auto 8px', opacity: 0.4 }} />
                            Image not available for page {images[current]?.page}
                        </div>
                    ) : (
                        <img
                            src={`${API}${images[current]?.url}`}
                            alt={`Page ${images[current]?.page}`}
                            onLoad={() => setLoaded(l => ({ ...l, [current]: true }))}
                            onError={() => setErrors(er => ({ ...er, [current]: true }))}
                            style={{
                                maxWidth: '85vw', maxHeight: '72vh',
                                objectFit: 'contain', display: 'block',
                                opacity: loaded[current] ? 1 : 0,
                                transition: 'opacity 0.25s',
                            }}
                        />
                    )}
                </div>

                {images.length > 1 && (
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        <button onClick={prev} disabled={current === 0} style={{
                            padding: '7px 14px', borderRadius: 9, background: '#111118',
                            border: '1px solid #1e1e2a', color: current === 0 ? '#2a2a38' : '#a1a1aa',
                            cursor: current === 0 ? 'not-allowed' : 'pointer',
                            display: 'flex', alignItems: 'center', gap: 5, fontSize: 12,
                            fontFamily: 'inherit', transition: 'all 0.15s',
                        }}>
                            <ChevronLeft size={13} /> Prev
                        </button>
                        <div style={{ display: 'flex', gap: 4 }}>
                            {images.map((img, i) => (
                                <button
                                    key={img.page}
                                    onClick={() => setCurrent(i)}
                                    style={{
                                        width: 28, height: 28, borderRadius: 7,
                                        background: i === current ? '#6366f1' : '#111118',
                                        border: `1px solid ${i === current ? '#6366f1' : '#1e1e2a'}`,
                                        color: i === current ? 'white' : '#52525b',
                                        fontSize: 11, fontWeight: 600, cursor: 'pointer',
                                        fontFamily: 'inherit', transition: 'all 0.15s',
                                    }}
                                >
                                    {img.page}
                                </button>
                            ))}
                        </div>
                        <button onClick={next} disabled={current === images.length - 1} style={{
                            padding: '7px 14px', borderRadius: 9, background: '#111118',
                            border: '1px solid #1e1e2a',
                            color: current === images.length - 1 ? '#2a2a38' : '#a1a1aa',
                            cursor: current === images.length - 1 ? 'not-allowed' : 'pointer',
                            display: 'flex', alignItems: 'center', gap: 5, fontSize: 12,
                            fontFamily: 'inherit', transition: 'all 0.15s',
                        }}>
                            Next <ChevronRight size={13} />
                        </button>
                    </div>
                )}
            </div>
        </div>
    );
};

/* ─────────────────────────────────────────
   Inline Image Strip
───────────────────────────────────────── */
const ImageStrip = ({ images, filename, onOpenViewer }) => {
    if (!images || images.length === 0) return null;
    return (
        <div style={{
            display: 'flex', gap: 8, flexWrap: 'wrap',
            marginTop: 12, paddingTop: 12,
            borderTop: '1px solid #1a1a24',
        }}>
            {images.map((img, i) => (
                <button
                    key={img.page}
                    onClick={() => onOpenViewer(images, i)}
                    style={{
                        position: 'relative',
                        width: 72, height: 72, borderRadius: 10, overflow: 'hidden',
                        background: '#0d0d12', border: '1px solid #1e1e2a',
                        cursor: 'pointer', padding: 0,
                        transition: 'all 0.2s', flexShrink: 0,
                    }}
                    onMouseEnter={e => { e.currentTarget.style.borderColor = '#6366f1'; e.currentTarget.style.transform = 'scale(1.06)'; }}
                    onMouseLeave={e => { e.currentTarget.style.borderColor = '#1e1e2a'; e.currentTarget.style.transform = 'scale(1)'; }}
                    title={`Page ${img.page}`}
                >
                    <PageThumb src={`${API}${img.url}`} />
                    <span style={{
                        position: 'absolute', bottom: 4, right: 5,
                        fontSize: 9, fontWeight: 700, color: 'white',
                        background: 'rgba(0,0,0,0.75)', borderRadius: 4,
                        padding: '1px 4px', lineHeight: 1.4,
                    }}>
                        p.{img.page}
                    </span>
                </button>
            ))}
        </div>
    );
};

const PageThumb = ({ src }) => {
    const [loaded, setLoaded] = useState(false);
    const [error, setError] = useState(false);
    return (
        <>
            {!loaded && !error && (
                <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#0d0d12' }}>
                    <Loader2 size={14} style={{ color: '#2e2e38', animation: 'spin 1s linear infinite' }} />
                </div>
            )}
            {error ? (
                <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#0d0d12' }}>
                    <Image size={14} style={{ color: '#2e2e38', opacity: 0.5 }} />
                </div>
            ) : (
                <img
                    src={src}
                    onLoad={() => setLoaded(true)}
                    onError={() => setError(true)}
                    style={{ width: '100%', height: '100%', objectFit: 'cover', opacity: loaded ? 1 : 0, transition: 'opacity 0.2s' }}
                    alt=""
                />
            )}
        </>
    );
};

/* ─────────────────────────────────────────
   Document Thumbnails Sidebar
───────────────────────────────────────── */
const DocThumbnailsSidebar = ({ filename, onOpen, open, onClose }) => {
    const [pages, setPages] = useState([]);
    const [loading, setLoading] = useState(false);
    const [viewerImages, setViewerImages] = useState(null);

    useEffect(() => {
        if (!filename || !open) return;
        setLoading(true);
        axios.get(`${API}/page-images/${encodeURIComponent(filename)}`)
            .then(res => setPages(res.data.images || []))
            .catch(() => setPages([]))
            .finally(() => setLoading(false));
    }, [filename, open]);

    return (
        <>
            {viewerImages && (
                <PageImageViewer images={viewerImages} filename={filename} onClose={() => setViewerImages(null)} />
            )}
            <div style={{
                position: 'absolute', right: 0, top: 0, bottom: 0,
                width: open ? 176 : 0,
                overflow: 'hidden',
                background: '#0a0a10',
                borderLeft: open ? '1px solid #16161f' : 'none',
                transition: 'width 0.25s cubic-bezier(0.4,0,0.2,1)',
                zIndex: 40, flexShrink: 0,
                display: 'flex', flexDirection: 'column',
            }}>
                <div style={{
                    padding: '11px 12px 8px',
                    borderBottom: '1px solid #16161f',
                    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                    flexShrink: 0,
                }}>
                    <span style={{ fontSize: 10, color: '#42424e', fontWeight: 600, letterSpacing: '0.09em', textTransform: 'uppercase' }}>
                        Pages
                    </span>
                    <button onClick={onClose} style={{ padding: 4, borderRadius: 6, background: 'transparent', border: 'none', cursor: 'pointer', color: '#42424e', display: 'flex' }}
                        onMouseEnter={e => e.currentTarget.style.color = '#a1a1aa'}
                        onMouseLeave={e => e.currentTarget.style.color = '#42424e'}>
                        <X size={12} />
                    </button>
                </div>
                <div style={{ flex: 1, overflowY: 'auto', padding: '10px 10px', display: 'flex', flexDirection: 'column', gap: 8 }}>
                    {loading && (
                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '20px 0' }}>
                            <Loader2 size={18} style={{ color: '#42424e', animation: 'spin 1s linear infinite' }} />
                        </div>
                    )}
                    {!loading && pages.length === 0 && (
                        <p style={{ fontSize: 11, color: '#2e2e38', textAlign: 'center', padding: '20px 0' }}>No page images</p>
                    )}
                    {pages.map((pg, i) => (
                        <button
                            key={pg.page}
                            onClick={() => { setViewerImages(pages); }}
                            style={{
                                position: 'relative', width: '100%', paddingBottom: '133%',
                                borderRadius: 8, overflow: 'hidden',
                                background: '#111118', border: '1px solid #1e1e2a',
                                cursor: 'pointer', padding: 0, flexShrink: 0,
                                transition: 'border-color 0.15s',
                            }}
                            onMouseEnter={e => e.currentTarget.style.borderColor = '#6366f1'}
                            onMouseLeave={e => e.currentTarget.style.borderColor = '#1e1e2a'}
                        >
                            <div style={{ position: 'absolute', inset: 0 }}>
                                <PageThumb src={`${API}${pg.url}`} />
                            </div>
                            <span style={{
                                position: 'absolute', bottom: 4, left: '50%', transform: 'translateX(-50%)',
                                fontSize: 9, fontWeight: 700, color: 'white',
                                background: 'rgba(0,0,0,0.75)', borderRadius: 4,
                                padding: '1px 6px', whiteSpace: 'nowrap',
                            }}>
                                {pg.page}
                            </span>
                        </button>
                    ))}
                </div>
            </div>
        </>
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
   Enhanced Markdown renderer — full-width tables
───────────────────────────────────────── */
const MarkdownMessage = ({ content }) => (
    <ReactMarkdown
        remarkPlugins={[remarkGfm, remarkMath]}
        rehypePlugins={[rehypeRaw, [rehypeKatex, { strict: false, throwOnError: false }]]}
        components={{
            div: ({ className, children, ...props }) => {
                if (className?.includes('math-display')) return (
                    <div style={{ margin: '14px 0', padding: '16px 20px', background: '#0a0a14', border: '1px solid rgba(99,102,241,0.18)', borderRadius: 10, overflowX: 'auto', textAlign: 'center' }} {...props}>{children}</div>
                );
                return <div className={className} {...props}>{children}</div>;
            },
            span: ({ className, children, ...props }) => {
                if (className?.includes('math-inline')) return (
                    <span style={{ padding: '2px 6px', borderRadius: 5, background: 'rgba(99,102,241,0.14)', color: '#a5b4fc', fontFamily: 'monospace', fontSize: '0.875em' }} {...props}>{children}</span>
                );
                return <span className={className} {...props}>{children}</span>;
            },

            table: ({ ...props }) => (
                <div style={{
                    overflowX: 'auto',
                    margin: '16px 0',
                    borderRadius: 10,
                    border: '1px solid #1e1e2a',
                    boxShadow: '0 1px 12px rgba(0,0,0,0.25)',
                    width: '100%',
                }}>
                    <table style={{
                        borderCollapse: 'collapse',
                        fontSize: 13,
                        width: '100%',
                        tableLayout: 'fixed',
                        whiteSpace: 'normal',
                        wordBreak: 'break-word',
                    }} {...props} />
                </div>
            ),
            thead: ({ ...props }) => (
                <thead style={{ background: '#13131c' }} {...props} />
            ),
            th: ({ ...props }) => (
                <th style={{
                    border: 'none',
                    borderBottom: '1px solid #1e1e2a',
                    padding: '11px 16px',
                    textAlign: 'left',
                    fontWeight: 600,
                    color: '#c4c4d4',
                    fontSize: 11.5,
                    letterSpacing: '0.06em',
                    textTransform: 'uppercase',
                    background: '#13131c',
                    whiteSpace: 'normal',
                    wordBreak: 'break-word',
                    lineHeight: 1.5,
                }} {...props} />
            ),
            td: ({ ...props }) => (
                <td style={{
                    border: 'none',
                    borderBottom: '1px solid #14141c',
                    padding: '10px 16px',
                    color: '#b0b0c4',
                    fontSize: 13,
                    lineHeight: 1.6,
                    background: 'transparent',
                    whiteSpace: 'normal',
                    wordBreak: 'break-word',
                    verticalAlign: 'top',
                }} {...props} />
            ),
            tr: ({ ...props }) => (
                <tr
                    style={{ transition: 'background 0.12s' }}
                    onMouseEnter={e => e.currentTarget.style.background = 'rgba(99,102,241,0.04)'}
                    onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
                    {...props}
                />
            ),
            tbody: ({ ...props }) => <tbody {...props} />,

            code: ({ inline, children, ...props }) => inline
                ? <code style={{ background: 'rgba(99,102,241,0.12)', padding: '2px 7px', borderRadius: 5, color: '#a5b4fc', fontSize: '0.84em', fontFamily: '"JetBrains Mono", "Fira Code", monospace' }} {...props}>{children}</code>
                : <pre style={{ background: '#0d0d14', border: '1px solid #1a1a24', borderRadius: 10, padding: '15px 18px', overflowX: 'auto', margin: '12px 0' }}>
                    <code style={{ color: '#86efac', fontSize: '0.81em', fontFamily: '"JetBrains Mono", "Fira Code", monospace', lineHeight: 1.75 }} {...props}>{children}</code>
                </pre>,

            h1: ({ ...props }) => <h1 style={{ fontSize: 19, fontWeight: 700, color: '#f4f4f5', margin: '18px 0 6px', letterSpacing: '-0.02em' }} {...props} />,
            h2: ({ ...props }) => <h2 style={{ fontSize: 16, fontWeight: 600, color: '#e4e4e7', margin: '14px 0 5px', letterSpacing: '-0.01em' }} {...props} />,
            h3: ({ ...props }) => <h3 style={{ fontSize: 14.5, fontWeight: 600, color: '#d4d4d8', margin: '12px 0 4px' }} {...props} />,
            ul: ({ ...props }) => <ul style={{ paddingLeft: 18, margin: '8px 0', display: 'flex', flexDirection: 'column', gap: 4 }} {...props} />,
            ol: ({ ...props }) => <ol style={{ paddingLeft: 18, margin: '8px 0', display: 'flex', flexDirection: 'column', gap: 4 }} {...props} />,
            li: ({ ...props }) => <li style={{ color: '#a0a0b8', lineHeight: 1.7, fontSize: 13.5 }} {...props} />,
            p: ({ ...props }) => <p style={{ margin: '0 0 10px', color: '#c8c8dc', lineHeight: 1.75, fontSize: 13.5 }} {...props} />,
            strong: ({ ...props }) => <strong style={{ fontWeight: 600, color: '#e8e8f8' }} {...props} />,
            em: ({ ...props }) => <em style={{ fontStyle: 'italic', color: '#9090a8' }} {...props} />,
            blockquote: ({ ...props }) => <blockquote style={{ borderLeft: '3px solid #6366f1', paddingLeft: 14, margin: '12px 0', color: '#6060a0', fontStyle: 'italic', background: 'rgba(99,102,241,0.05)', borderRadius: '0 8px 8px 0', padding: '10px 14px' }} {...props} />,
            a: ({ ...props }) => <a style={{ color: '#818cf8', textDecoration: 'underline', textUnderlineOffset: 3 }} target="_blank" rel="noopener noreferrer" {...props} />,
            hr: ({ ...props }) => <hr style={{ border: 'none', borderTop: '1px solid #1a1a24', margin: '16px 0' }} {...props} />,
        }}
    >
        {normaliseContent(content)}
    </ReactMarkdown>
);

/* ─────────────────────────────────────────
   Typing dots
───────────────────────────────────────── */
const TypingDots = () => (
    <div style={{ display: 'flex', gap: 5, alignItems: 'center', padding: '5px 0' }}>
        {[0, 140, 280].map((delay, i) => (
            <span key={i} style={{
                width: 6, height: 6, borderRadius: '50%',
                background: '#42424e',
                animation: `bounce 1.2s ease-in-out ${delay}ms infinite`,
                display: 'block',
            }} />
        ))}
    </div>
);

/* ─────────────────────────────────────────
   FileOption
───────────────────────────────────────── */
const FileOption = ({ name, status, selected, onSelect }) => (
    <button
        className="file-option"
        onClick={onSelect}
        style={{
            width: '100%', textAlign: 'left',
            padding: '9px 14px', fontSize: 12.5,
            display: 'flex', alignItems: 'center', gap: 9,
            background: selected ? 'rgba(99,102,241,0.1)' : 'transparent',
            color: selected ? '#818cf8' : '#a1a1aa',
            border: 'none', cursor: 'pointer',
            fontFamily: 'inherit', transition: 'background 0.1s, color 0.1s',
        }}
    >
        <FileText size={12} style={{ flexShrink: 0 }} />
        <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{name}</span>
        {status === 'indexing' && <Clock size={11} style={{ color: '#f59e0b', flexShrink: 0 }} />}
        {selected && status !== 'indexing' && <CheckCircle size={12} style={{ flexShrink: 0, color: '#6366f1' }} />}
    </button>
);

/* ─────────────────────────────────────────
   Suggested Questions (shown in empty state)
───────────────────────────────────────── */
const SuggestedQuestions = ({ file, onSelect }) => {
    if (!file) return null;
    const prompts = [
        'Summarize this document',
        'What are the key findings?',
        'List all tables and figures',
        'What are the main conclusions?',
    ];
    return (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, justifyContent: 'center', maxWidth: 520 }}>
            {prompts.map(p => (
                <button
                    key={p}
                    onClick={() => onSelect(p)}
                    style={{
                        padding: '8px 14px', borderRadius: 99,
                        background: 'rgba(99,102,241,0.08)',
                        border: '1px solid rgba(99,102,241,0.2)',
                        color: '#818cf8', fontSize: 12.5, fontWeight: 500,
                        cursor: 'pointer', fontFamily: 'inherit',
                        transition: 'all 0.15s',
                    }}
                    onMouseEnter={e => { e.currentTarget.style.background = 'rgba(99,102,241,0.16)'; e.currentTarget.style.borderColor = 'rgba(99,102,241,0.4)'; }}
                    onMouseLeave={e => { e.currentTarget.style.background = 'rgba(99,102,241,0.08)'; e.currentTarget.style.borderColor = 'rgba(99,102,241,0.2)'; }}
                >
                    {p}
                </button>
            ))}
        </div>
    );
};

/* ─────────────────────────────────────────
   Main Chatbot
───────────────────────────────────────── */
const Chatbot = () => {
    const [messages, setMessages] = useState([{
        id: 1, type: 'bot',
        content: 'Hello! Upload a PDF or TXT file and start asking questions about it.',
        timestamp: new Date(),
        images: [],
    }]);
    const [inputValue, setInputValue] = useState('');
    const [isTyping, setIsTyping] = useState(false);
    const [showReport, setShowReport] = useState(false);
    const [files, setFiles] = useState([]);
    const [selectedFile, setSelectedFile] = useState('');
    const [uploading, setUploading] = useState(false);
    const [uploadProgress, setUploadProgress] = useState('Uploading…');
    const [showDropdown, setShowDropdown] = useState(false);
    const [showUploadPanel, setShowUploadPanel] = useState(false);
    const [showScrollBtn, setShowScrollBtn] = useState(false);
    const [userScrolled, setUserScrolled] = useState(false);
    const [showSidebar, setShowSidebar] = useState(false);
    const [viewerImages, setViewerImages] = useState(null);

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

    useEffect(() => {
        if (!userScrolled) scrollToBottom('smooth');
    }, [messages, userScrolled, scrollToBottom]);

    useEffect(() => {
        if (isTyping && isAtBottomRef.current) scrollToBottom('auto');
    }, [messages, isTyping, scrollToBottom]);

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
            const updated = await Promise.all(
                files.map(async f => {
                    if (f.status !== 'indexing') return f;
                    try {
                        const res = await axios.get(`${API}/status/${encodeURIComponent(f.name)}`);
                        const newStatus = res.data.status;
                        if (newStatus !== f.status) anyChange = true;
                        return { ...f, status: newStatus };
                    } catch { return f; }
                })
            );
            if (anyChange) setFiles(updated);
        }, 3000);
        return () => clearInterval(interval);
    }, [files]);

    const fetchFiles = async () => {
        try {
            const res = await axios.get(`${API}/files`);
            const raw = res.data.files || [];
            const list = raw.map(f => (typeof f === 'string' ? { name: f, status: 'ready' } : { name: f.name, status: f.status || 'ready' }));
            setFiles(list);
            if (list.length > 0 && !selectedFile) setSelectedFile(list[0].name);
        } catch (e) { console.error('Failed to fetch files:', e); }
    };

    const handleReindex = async (filename) => {
        try {
            await axios.post(`${API}/reindex`, { filename });
            setFiles(prev => prev.map(f => f.name === filename ? { ...f, status: 'indexing' } : f));
            setMessages(prev => [...prev, {
                id: Date.now(), type: 'bot',
                content: `🔄 Re-indexing **"${filename}"** started. This may take a moment.`,
                timestamp: new Date(), images: [],
            }]);
        } catch (err) {
            setMessages(prev => [...prev, {
                id: Date.now(), type: 'bot',
                content: `⚠️ Re-index failed: ${err.response?.data?.error || err.message}`,
                timestamp: new Date(), images: [],
            }]);
        }
    };

    const handleUploadFile = async (file) => {
        if (!file) return;
        const ext = '.' + file.name.split('.').pop().toLowerCase();
        if (!['.pdf', '.txt'].includes(ext)) {
            alert('Only PDF and TXT files are supported.');
            return;
        }
        setUploading(true);
        setUploadProgress('Uploading file…');
        const formData = new FormData();
        formData.append('file', file);
        try {
            const progressTimer = setTimeout(() => setUploadProgress('Indexing document…'), 1500);
            const res = await axios.post(`${API}/upload`, formData, {
                headers: { 'Content-Type': 'multipart/form-data' }
            });
            clearTimeout(progressTimer);
            const uploaded = res.data.file;
            await fetchFiles();
            setSelectedFile(uploaded);
            setShowUploadPanel(false);
            setMessages(prev => [...prev, {
                id: Date.now(), type: 'bot',
                content: `✅ **"${uploaded}"** uploaded and indexed! You can now ask questions about it.`,
                timestamp: new Date(), images: [],
            }]);
        } catch (err) {
            setMessages(prev => [...prev, {
                id: Date.now(), type: 'bot',
                content: `⚠️ Upload failed: ${err.response?.data?.error || err.message}`,
                timestamp: new Date(), images: [],
            }]);
        } finally {
            setUploading(false);
            setUploadProgress('Uploading…');
        }
    };

    const openViewer = useCallback((images, startIdx = 0) => {
        setViewerImages(images);
    }, []);

    const handleSend = async (overrideText) => {
        const text = overrideText || inputValue;
        if (!text.trim()) return;
        if (!selectedFile) {
            setMessages(prev => [...prev, {
                id: Date.now(), type: 'bot',
                content: '⚠️ Please upload or select a file first.',
                timestamp: new Date(), images: [],
            }]);
            return;
        }

        const userMsg = { id: Date.now(), type: 'user', content: text, timestamp: new Date() };
        setMessages(prev => [...prev, userMsg]);
        setInputValue('');
        setIsTyping(true);
        setUserScrolled(false);
        isAtBottomRef.current = true;

        const botId = Date.now() + 1;
        setMessages(prev => [...prev, { id: botId, type: 'bot', content: '', timestamp: new Date(), images: [] }]);

        try {
            const response = await fetch(`${API}/generate`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    prompt: userMsg.content,
                    filename: selectedFile,
                    temperature: 0.4,
                    max_output_tokens: 1024,
                    top_p: 0.9,
                })
            });

            const contentType = response.headers.get('content-type') || '';

            if (contentType.includes('application/json')) {
                const data = await response.json();
                setMessages(prev => prev.map(msg =>
                    msg.id === botId ? { ...msg, content: data.response || '' } : msg
                ));
                return;
            }

            const tokenQueue = [];
            const DRIP_INTERVAL = 18;
            const CHARS_PER_TICK = 2;

            const drip = setInterval(() => {
                if (tokenQueue.length === 0) return;
                const chunk = tokenQueue.splice(0, CHARS_PER_TICK).join('');
                setMessages(prev => prev.map(msg =>
                    msg.id === botId ? { ...msg, content: msg.content + chunk } : msg
                ));
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
                        if (json.images) {
                            setMessages(prev => prev.map(msg =>
                                msg.id === botId ? { ...msg, images: json.images } : msg
                            ));
                            continue;
                        }
                        const token = json.token || '';
                        if (token) tokenQueue.push(...token.split(''));
                    } catch { }
                }
            }

            await new Promise(resolve => {
                const drain = setInterval(() => {
                    if (tokenQueue.length === 0) { clearInterval(drain); resolve(); return; }
                    const chunk = tokenQueue.splice(0, CHARS_PER_TICK).join('');
                    setMessages(prev => prev.map(msg =>
                        msg.id === botId ? { ...msg, content: msg.content + chunk } : msg
                    ));
                    if (isAtBottomRef.current) scrollToBottom('auto');
                }, DRIP_INTERVAL);
            });

            clearInterval(drip);
        } catch (error) {
            setMessages(prev => prev.map(msg =>
                msg.id === botId ? { ...msg, content: `⚠️ Error: ${error.message}` } : msg
            ));
        } finally {
            setIsTyping(false);
        }
    };

    const handleKeyDown = (e) => {
        if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSend(); }
    };

    const isEmpty = files.length === 0 && messages.length <= 1;
    const hasFileButEmpty = files.length > 0 && messages.length <= 1;

    return (
        <>
            <style>{`
                @import url('https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600&family=JetBrains+Mono:wght@400;500&display=swap');

                * { box-sizing: border-box; margin: 0; padding: 0; }

                ::-webkit-scrollbar { width: 4px; height: 4px; }
                ::-webkit-scrollbar-track { background: transparent; }
                ::-webkit-scrollbar-thumb { background: #2e2e3a; border-radius: 99px; }
                ::-webkit-scrollbar-thumb:hover { background: #42424e; }

                @keyframes spin { to { transform: rotate(360deg); } }
                @keyframes bounce {
                    0%, 80%, 100% { transform: translateY(0); opacity: 0.35; }
                    40% { transform: translateY(-5px); opacity: 1; }
                }
                @keyframes shimmer {
                    0% { opacity: 0.5; } 50% { opacity: 1; } 100% { opacity: 0.5; }
                }
                @keyframes modalIn {
                    from { opacity: 0; transform: scale(0.95) translateY(8px); }
                    to   { opacity: 1; transform: scale(1) translateY(0); }
                }
                @keyframes fadeSlideUp {
                    from { opacity: 0; transform: translateY(12px); }
                    to   { opacity: 1; transform: translateY(0); }
                }
                @keyframes fadeIn {
                    from { opacity: 0; } to { opacity: 1; }
                }
                @keyframes scrollBtnIn {
                    from { opacity: 0; transform: translateX(-50%) translateY(10px); }
                    to   { opacity: 1; transform: translateX(-50%) translateY(0); }
                }
                @keyframes pulse {
                    0%, 100% { opacity: 1; } 50% { opacity: 0.5; }
                }

                .msg-bot { animation: fadeSlideUp 0.22s ease forwards; }
                .msg-user { animation: fadeSlideUp 0.16s ease forwards; }

                .send-btn:not(:disabled):hover { background: #4f46e5 !important; }
                .send-btn:not(:disabled):active { transform: scale(0.92); }

                .input-area:focus-within {
                    border-color: rgba(99,102,241,0.5) !important;
                    box-shadow: 0 0 0 3px rgba(99,102,241,0.1) !important;
                }

                .file-chip:hover { background: rgba(99,102,241,0.18) !important; border-color: rgba(99,102,241,0.4) !important; }
                .file-option:not([data-selected]):hover { background: #1a1a26 !important; color: #e4e4e7 !important; }

                .topbar-btn:hover { background: #1a1a26 !important; border-color: #2e2e3a !important; color: #e4e4e7 !important; }
                .topbar-btn.active { background: #1f1f30 !important; border-color: rgba(99,102,241,0.35) !important; color: #818cf8 !important; }
            `}</style>

            <div style={{
                position: 'relative', display: 'flex', flexDirection: 'column',
                height: '100vh', background: '#08080e',
                fontFamily: '"Inter", -apple-system, BlinkMacSystemFont, sans-serif',
                color: '#e4e4e7', overflow: 'hidden',
            }}>
                {/* Upload Panel */}
                {showUploadPanel && (
                    <UploadPanel
                        onUpload={handleUploadFile}
                        uploading={uploading}
                        uploadProgress={uploadProgress}
                        onClose={() => setShowUploadPanel(false)}
                        files={files}
                        selectedFile={selectedFile}
                        onSelectFile={setSelectedFile}
                        onReindex={handleReindex}
                    />
                )}

                {/* Image Viewer */}
                {viewerImages && (
                    <PageImageViewer images={viewerImages} filename={selectedFile} onClose={() => setViewerImages(null)} />
                )}

                {/* ── Top Bar ── */}
                <div style={{
                    borderBottom: '1px solid #12121a',
                    padding: '0 18px',
                    height: 54,
                    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                    flexShrink: 0,
                    background: 'rgba(8,8,14,0.98)',
                    backdropFilter: 'blur(14px)',
                    position: 'sticky', top: 0, zIndex: 100,
                }}>
                    {/* Logo */}
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                        <div style={{
                            width: 30, height: 30, borderRadius: 9,
                            background: 'linear-gradient(135deg, #6366f1, #4f46e5)',
                            display: 'flex', alignItems: 'center', justifyContent: 'center',
                            boxShadow: '0 2px 14px rgba(99,102,241,0.4)',
                            flexShrink: 0,
                        }}>
                            <Zap size={14} fill="white" stroke="none" />
                        </div>
                        <div>
                            <p style={{ fontSize: 13.5, fontWeight: 600, color: '#f4f4f5', lineHeight: 1, letterSpacing: '-0.02em' }}>CMTI Bot</p>
                            <p style={{ fontSize: 10, color: '#42424e', lineHeight: 1, marginTop: 2, letterSpacing: '0.01em' }}>AI Document Assistant</p>
                        </div>
                    </div>

                    {/* Right controls */}
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                        {/* New Chat */}
                        <button
                            className="topbar-btn"
                            onClick={() => {
                                setMessages([{ id: 1, type: 'bot', content: 'Hello! Upload a PDF or TXT file and start asking questions about it.', timestamp: new Date(), images: [] }]);
                                setInputValue('');
                                setUserScrolled(false);
                            }}
                            style={{
                                display: 'flex', alignItems: 'center', gap: 5,
                                background: 'transparent', border: '1px solid #1e1e2a',
                                color: '#71717a', padding: '5px 11px', borderRadius: 8,
                                fontSize: 12, fontWeight: 500, cursor: 'pointer',
                                transition: 'all 0.15s', fontFamily: 'inherit',
                            }}
                        >
                            <Plus size={12} />
                            <span style={{ display: window.innerWidth < 480 ? 'none' : 'inline' }}>New chat</span>
                        </button>

                        {selectedFile && (
                            <button
                                className={`topbar-btn${showReport ? ' active' : ''}`}
                                onClick={() => setShowReport(s => !s)}
                                style={{
                                    display: 'flex', alignItems: 'center', gap: 5,
                                    background: 'transparent', border: '1px solid #1e1e2a',
                                    color: '#71717a', padding: '5px 11px', borderRadius: 8,
                                    fontSize: 12, fontWeight: 500, cursor: 'pointer',
                                    transition: 'all 0.15s', fontFamily: 'inherit',
                                }}
                            >
                                <FileText size={12} />
                                <span style={{ display: window.innerWidth < 480 ? 'none' : 'inline' }}>Report</span>
                            </button>
                        )}

                        {selectedFile && (
                            <button
                                className={`topbar-btn${showSidebar ? ' active' : ''}`}
                                onClick={() => setShowSidebar(s => !s)}
                                title="View all pages"
                                style={{
                                    display: 'flex', alignItems: 'center', gap: 5,
                                    background: 'transparent', border: '1px solid #1e1e2a',
                                    color: '#71717a', padding: '5px 11px', borderRadius: 8,
                                    fontSize: 12, fontWeight: 500, cursor: 'pointer',
                                    transition: 'all 0.15s', fontFamily: 'inherit',
                                }}
                            >
                                <LayoutGrid size={12} />
                                <span style={{ display: window.innerWidth < 480 ? 'none' : 'inline' }}>Pages</span>
                            </button>
                        )}

                        <button
                            className="topbar-btn"
                            onClick={() => setShowUploadPanel(true)}
                            disabled={uploading}
                            style={{
                                display: 'flex', alignItems: 'center', gap: 5,
                                background: 'transparent', border: '1px solid #1e1e2a',
                                color: uploading ? '#42424e' : '#818cf8', padding: '5px 11px', borderRadius: 8,
                                fontSize: 12, fontWeight: 500, cursor: uploading ? 'wait' : 'pointer',
                                transition: 'all 0.15s', opacity: uploading ? 0.65 : 1,
                                fontFamily: 'inherit',
                            }}
                        >
                            {uploading
                                ? <Loader2 size={12} style={{ animation: 'spin 1s linear infinite' }} />
                                : <Upload size={12} />
                            }
                            <span style={{ display: window.innerWidth < 480 ? 'none' : 'inline' }}>{uploading ? 'Indexing…' : 'Upload'}</span>
                        </button>

                        {/* File selector dropdown */}
                        <div style={{ position: 'relative' }}>
                            {showDropdown && (
                                <div style={{ position: 'fixed', inset: 0, zIndex: 1 }} onClick={() => setShowDropdown(false)} />
                            )}
                            <button
                                onClick={() => setShowDropdown(prev => !prev)}
                                style={{
                                    position: 'relative', zIndex: 3,
                                    display: 'flex', alignItems: 'center', gap: 6,
                                    background: showDropdown ? '#1a1a26' : 'transparent',
                                    border: `1px solid ${showDropdown ? 'rgba(99,102,241,0.3)' : '#1e1e2a'}`,
                                    color: '#c4c4d4', padding: '5px 11px', borderRadius: 8,
                                    fontSize: 12, fontWeight: 500, cursor: 'pointer',
                                    transition: 'all 0.15s', fontFamily: 'inherit',
                                    maxWidth: 200,
                                }}
                            >
                                <FileText size={12} style={{ color: '#6366f1', flexShrink: 0 }} />
                                <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1, maxWidth: 130 }}>
                                    {selectedFile || 'No file'}
                                </span>
                                {files.find(f => f.name === selectedFile)?.status === 'indexing' && (
                                    <Clock size={10} style={{ color: '#f59e0b', flexShrink: 0 }} />
                                )}
                                <ChevronDown size={11} style={{ color: '#42424e', flexShrink: 0, transform: showDropdown ? 'rotate(180deg)' : 'rotate(0)', transition: 'transform 0.2s' }} />
                            </button>

                            {showDropdown && (
                                <div style={{
                                    position: 'absolute', right: 0, top: 'calc(100% + 6px)',
                                    width: 260, background: '#111118',
                                    border: '1px solid #1e1e2a', borderRadius: 12,
                                    boxShadow: '0 20px 60px rgba(0,0,0,0.65)',
                                    zIndex: 2, overflow: 'hidden',
                                    animation: 'fadeIn 0.14s ease',
                                }}>
                                    {files.length === 0
                                        ? <p style={{ color: '#42424e', fontSize: 12.5, padding: '12px 16px' }}>No files indexed yet</p>
                                        : files.map(f => (
                                            <FileOption
                                                key={f.name}
                                                name={f.name}
                                                status={f.status}
                                                selected={selectedFile === f.name}
                                                onSelect={() => { setSelectedFile(f.name); setShowDropdown(false); }}
                                            />
                                        ))
                                    }
                                </div>
                            )}
                        </div>
                    </div>
                </div>

                {/* ── Main area ── */}
                <div style={{ flex: 1, position: 'relative', overflow: 'hidden', display: 'flex' }}>

                    {/* ── Empty / welcome state ── */}
                    {(isEmpty || (hasFileButEmpty)) && (
                        <div style={{
                            flex: 1, display: 'flex', flexDirection: 'column',
                            alignItems: 'center', justifyContent: 'center',
                            gap: 20, padding: '0 24px',
                            animation: 'fadeSlideUp 0.35s ease',
                        }}>
                            <div style={{
                                width: 52, height: 52, borderRadius: 15,
                                background: 'linear-gradient(135deg, rgba(99,102,241,0.15), rgba(79,70,229,0.08))',
                                border: '1px solid rgba(99,102,241,0.2)',
                                display: 'flex', alignItems: 'center', justifyContent: 'center',
                            }}>
                                <Sparkles size={22} style={{ color: '#6366f1' }} />
                            </div>
                            <div style={{ textAlign: 'center' }}>
                                <p style={{ fontSize: 16, fontWeight: 600, color: '#e4e4e7', letterSpacing: '-0.02em' }}>
                                    {isEmpty ? 'No documents yet' : `Ask about ${selectedFile}`}
                                </p>
                                <p style={{ fontSize: 12.5, color: '#42424e', marginTop: 5 }}>
                                    {isEmpty ? 'Upload a PDF or TXT to start asking questions' : 'Type a question or choose a suggestion below'}
                                </p>
                            </div>
                            {isEmpty ? (
                                <button
                                    onClick={() => setShowUploadPanel(true)}
                                    style={{
                                        display: 'flex', alignItems: 'center', gap: 8,
                                        background: '#6366f1', color: 'white',
                                        padding: '10px 20px', borderRadius: 10,
                                        fontSize: 13, fontWeight: 500,
                                        border: 'none', cursor: 'pointer',
                                        fontFamily: 'inherit', transition: 'background 0.15s',
                                        boxShadow: '0 4px 16px rgba(99,102,241,0.35)',
                                    }}
                                    onMouseEnter={e => e.currentTarget.style.background = '#4f46e5'}
                                    onMouseLeave={e => e.currentTarget.style.background = '#6366f1'}
                                >
                                    <Upload size={14} />
                                    Upload a document
                                </button>
                            ) : (
                                <SuggestedQuestions file={selectedFile} onSelect={t => handleSend(t)} />
                            )}
                        </div>
                    )}

                    {/* ── Messages ── */}
                    {!isEmpty && !hasFileButEmpty && (
                        <div
                            ref={scrollContainerRef}
                            onScroll={handleScroll}
                            style={{
                                flex: 1, overflowY: 'auto',
                                padding: '28px 20px 20px',
                                display: 'flex', flexDirection: 'column',
                            }}
                        >
                            <div style={{ maxWidth: 780, width: '100%', margin: '0 auto', display: 'flex', flexDirection: 'column', gap: 20 }}>
                                {messages.map((msg, idx) => (
                                    <div
                                        key={msg.id}
                                        className={msg.type === 'user' ? 'msg-user' : 'msg-bot'}
                                        style={{
                                            display: 'flex',
                                            justifyContent: msg.type === 'user' ? 'flex-end' : 'flex-start',
                                            animationDelay: `${Math.min(idx * 0.03, 0.18)}s`,
                                            animationFillMode: 'both',
                                        }}
                                    >
                                        {msg.type === 'user' ? (
                                            <div style={{
                                                maxWidth: '72%',
                                                background: 'linear-gradient(135deg, #4f46e5, #6366f1)',
                                                color: '#eef2ff',
                                                padding: '10px 15px',
                                                borderRadius: '16px 16px 3px 16px',
                                                fontSize: 13.5, lineHeight: 1.65,
                                                boxShadow: '0 2px 16px rgba(99,102,241,0.28)',
                                            }}>
                                                {msg.content}
                                            </div>
                                        ) : (
                                            <div style={{ display: 'flex', gap: 11, maxWidth: '100%', alignItems: 'flex-start', width: '100%' }}>
                                                <div style={{
                                                    width: 28, height: 28, borderRadius: 9, flexShrink: 0,
                                                    background: 'linear-gradient(135deg, #6366f1, #4f46e5)',
                                                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                                                    boxShadow: '0 2px 10px rgba(99,102,241,0.3)',
                                                    marginTop: 2,
                                                }}>
                                                    <Zap size={12} fill="white" stroke="none" />
                                                </div>
                                                <div style={{
                                                    flex: 1,
                                                    minWidth: 0,
                                                    overflowX: 'hidden',
                                                    paddingTop: 2,
                                                }}>
                                                    {msg.content
                                                        ? <MarkdownMessage content={msg.content} />
                                                        : isTyping && idx === messages.length - 1
                                                            ? <TypingDots />
                                                            : null
                                                    }
                                                    {msg.images && msg.images.length > 0 && (
                                                        <ImageStrip
                                                            images={msg.images}
                                                            filename={selectedFile}
                                                            onOpenViewer={openViewer}
                                                        />
                                                    )}
                                                </div>
                                            </div>
                                        )}
                                    </div>
                                ))}
                                <div ref={messagesEndRef} style={{ height: 1 }} />
                            </div>
                        </div>
                    )}

                    {/* ── Report panel ── */}
                    {showReport && selectedFile && (
                        <div style={{
                            position: 'absolute', right: showSidebar ? 176 : 0, top: 0, bottom: 0,
                            width: 460, overflowY: 'auto',
                            background: '#0a0a10',
                            borderLeft: '1px solid #16161f',
                            padding: '20px',
                            zIndex: 35,
                            transition: 'right 0.25s cubic-bezier(0.4,0,0.2,1)',
                        }}>
                            <ReportPanel filename={selectedFile} apiBase={API} />
                        </div>
                    )}

                    {/* ── Page thumbnails sidebar ── */}
                    <DocThumbnailsSidebar
                        filename={selectedFile}
                        open={showSidebar}
                        onOpen={() => setShowSidebar(true)}
                        onClose={() => setShowSidebar(false)}
                    />
                </div>

                {/* ── Scroll-to-bottom button ── */}
                {showScrollBtn && (
                    <button
                        onClick={() => { setUserScrolled(false); scrollToBottom('smooth'); }}
                        style={{
                            position: 'absolute',
                            bottom: 104, left: '50%',
                            transform: 'translateX(-50%)',
                            zIndex: 25,
                            display: 'flex', alignItems: 'center', gap: 5,
                            background: '#111118',
                            border: '1px solid #2e2e3a',
                            color: '#a1a1aa',
                            padding: '7px 14px', borderRadius: 99,
                            fontSize: 12, fontWeight: 500,
                            cursor: 'pointer', fontFamily: 'inherit',
                            boxShadow: '0 4px 24px rgba(0,0,0,0.5)',
                            animation: 'scrollBtnIn 0.2s cubic-bezier(0.34,1.56,0.64,1)',
                            transition: 'all 0.15s',
                            whiteSpace: 'nowrap',
                        }}
                        onMouseEnter={e => { e.currentTarget.style.background = '#1a1a26'; e.currentTarget.style.color = '#e4e4e7'; e.currentTarget.style.borderColor = '#42424e'; }}
                        onMouseLeave={e => { e.currentTarget.style.background = '#111118'; e.currentTarget.style.color = '#a1a1aa'; e.currentTarget.style.borderColor = '#2e2e3a'; }}
                    >
                        <ArrowDown size={12} />
                        Scroll to bottom
                    </button>
                )}

                {/* ── Input Bar ── */}
                <div style={{
                    borderTop: '1px solid #12121a',
                    padding: '10px 18px 14px',
                    flexShrink: 0,
                    background: 'rgba(8,8,14,0.98)',
                    backdropFilter: 'blur(14px)',
                }}>
                    {/* Active file chip */}
                    {selectedFile && (
                        <div style={{ maxWidth: 780, margin: '0 auto 8px' }}>
                            <span
                                className="file-chip"
                                style={{
                                    display: 'inline-flex', alignItems: 'center', gap: 5,
                                    background: 'rgba(99,102,241,0.08)',
                                    border: '1px solid rgba(99,102,241,0.18)',
                                    color: '#818cf8', fontSize: 11, fontWeight: 500,
                                    padding: '4px 10px', borderRadius: 99,
                                    cursor: 'pointer', transition: 'all 0.15s',
                                    letterSpacing: '0.01em',
                                }}
                                onClick={() => setShowUploadPanel(true)}
                            >
                                <FileText size={10} />
                                {selectedFile}
                                {files.find(f => f.name === selectedFile)?.status === 'indexing' && (
                                    <span style={{ display: 'flex', alignItems: 'center', gap: 3, color: '#f59e0b' }}>
                                        <Clock size={9} /> indexing…
                                    </span>
                                )}
                            </span>
                        </div>
                    )}

                    {/* Textarea + buttons */}
                    <div style={{ maxWidth: 780, margin: '0 auto' }}>
                        <div
                            className="input-area"
                            style={{
                                display: 'flex', alignItems: 'flex-end', gap: 8,
                                background: '#0f0f18', border: '1px solid #1e1e2a',
                                borderRadius: 14, padding: '8px 8px 8px 13px',
                                transition: 'border-color 0.2s, box-shadow 0.2s',
                            }}
                        >
                            <button
                                onClick={() => setShowUploadPanel(true)}
                                disabled={uploading}
                                style={{
                                    padding: 7, borderRadius: 8, background: 'transparent',
                                    border: 'none', cursor: uploading ? 'wait' : 'pointer',
                                    color: '#42424e', flexShrink: 0, opacity: uploading ? 0.5 : 1,
                                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                                    transition: 'all 0.15s', marginBottom: 1,
                                }}
                                onMouseEnter={e => { if (!uploading) { e.currentTarget.style.color = '#818cf8'; e.currentTarget.style.background = '#1a1a26'; } }}
                                onMouseLeave={e => { e.currentTarget.style.color = '#42424e'; e.currentTarget.style.background = 'transparent'; }}
                            >
                                {uploading
                                    ? <Loader2 size={16} style={{ color: '#6366f1', animation: 'spin 1s linear infinite' }} />
                                    : <Paperclip size={16} />
                                }
                            </button>

                            <textarea
                                ref={textareaRef}
                                value={inputValue}
                                onChange={e => setInputValue(e.target.value)}
                                onKeyDown={handleKeyDown}
                                placeholder={!selectedFile ? 'Upload a file to start…' : `Ask anything about ${selectedFile}…`}
                                rows={1}
                                style={{
                                    flex: 1, background: 'transparent', border: 'none',
                                    outline: 'none', resize: 'none', color: '#e4e4e7',
                                    fontSize: 13.5, lineHeight: 1.6, fontFamily: 'inherit',
                                    padding: '5px 0', maxHeight: 160, overflowY: 'auto',
                                }}
                            />

                            <button
                                className="send-btn"
                                onClick={() => handleSend()}
                                disabled={!inputValue.trim() || !selectedFile || uploading}
                                style={{
                                    width: 33, height: 33, borderRadius: 9, flexShrink: 0,
                                    background: inputValue.trim() && selectedFile && !uploading ? '#6366f1' : '#1a1a26',
                                    border: 'none', cursor: inputValue.trim() && selectedFile && !uploading ? 'pointer' : 'not-allowed',
                                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                                    color: inputValue.trim() && selectedFile && !uploading ? 'white' : '#2e2e38',
                                    transition: 'all 0.15s',
                                    marginBottom: 1,
                                    boxShadow: inputValue.trim() && selectedFile && !uploading ? '0 2px 12px rgba(99,102,241,0.4)' : 'none',
                                }}
                            >
                                <Send size={14} />
                            </button>
                        </div>

                        <p style={{ fontSize: 11, color: '#2a2a38', textAlign: 'center', marginTop: 7, letterSpacing: '0.01em' }}>
                            Answers are grounded in the selected document only
                        </p>
                    </div>
                </div>
            </div>
        </>
    );
};

export default Chatbot;