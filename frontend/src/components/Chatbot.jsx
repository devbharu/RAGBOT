import React, { useState, useRef, useEffect, useCallback } from 'react';
import {
    Send, Paperclip, FileText, ChevronDown,
    Upload, X, FileUp, CheckCircle, Loader2,
    ArrowDown, Plus, Sparkles, Image, ChevronLeft,
    ChevronRight, LayoutGrid, RefreshCw, Clock
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
                gap: '16px',
                border: `2px dashed ${dragging ? '#60a5fa' : '#3f3f46'}`,
                borderRadius: '16px',
                padding: '40px 24px',
                cursor: uploading ? 'wait' : 'pointer',
                transition: 'all 0.2s ease',
                background: dragging ? 'rgba(96,165,250,0.06)' : 'rgba(39,39,42,0.5)',
                opacity: uploading ? 0.8 : 1,
                pointerEvents: uploading ? 'none' : 'auto',
            }}
        >
            <input
                ref={inputRef} type="file" accept=".pdf,.txt"
                onChange={(e) => { const f = e.target.files[0]; if (f) onUpload(f); e.target.value = ''; }}
                style={{ display: 'none' }}
            />
            <div style={{
                width: 52, height: 52, borderRadius: 14,
                background: dragging ? 'rgba(96,165,250,0.15)' : 'rgba(63,63,70,0.8)',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                transition: 'all 0.2s'
            }}>
                {uploading
                    ? <Loader2 size={24} style={{ color: '#60a5fa', animation: 'spin 1s linear infinite' }} />
                    : <FileUp size={24} style={{ color: dragging ? '#60a5fa' : '#71717a' }} />
                }
            </div>
            <div style={{ textAlign: 'center' }}>
                <p style={{ fontSize: 14, fontWeight: 500, color: '#e4e4e7', margin: 0 }}>
                    {uploading ? uploadProgress : dragging ? 'Drop to upload' : 'Drop file here'}
                </p>
                <p style={{ fontSize: 12, color: '#71717a', marginTop: 4 }}>
                    {uploading ? 'Processing, this may take a moment…' : 'or click to browse · PDF & TXT'}
                </p>
            </div>
            {uploading && (
                <div style={{ width: '100%', height: 2, background: '#27272a', borderRadius: 99, overflow: 'hidden' }}>
                    <div style={{ height: '100%', background: 'linear-gradient(90deg,#3b82f6,#60a5fa)', borderRadius: 99, animation: 'shimmer 1.5s ease-in-out infinite', width: '100%' }} />
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
            background: 'rgba(0,0,0,0.7)', backdropFilter: 'blur(8px)',
        }}
        onClick={() => !uploading && onClose()}
    >
        <div
            style={{
                position: 'relative', width: '100%', maxWidth: 440,
                margin: '0 16px',
                background: 'linear-gradient(160deg, #1c1c1f 0%, #18181b 100%)',
                border: '1px solid #2d2d30',
                borderRadius: 24, padding: 24,
                display: 'flex', flexDirection: 'column', gap: 20,
                boxShadow: '0 24px 80px rgba(0,0,0,0.6)',
                animation: 'modalIn 0.2s cubic-bezier(0.34,1.56,0.64,1)',
            }}
            onClick={e => e.stopPropagation()}
        >
            <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between' }}>
                <div>
                    <h2 style={{ fontSize: 15, fontWeight: 600, color: '#f4f4f5', margin: 0 }}>Upload Document</h2>
                    <p style={{ fontSize: 12, color: '#52525b', marginTop: 3 }}>PDF or TXT · indexed automatically</p>
                </div>
                {!uploading && (
                    <button onClick={onClose} style={{
                        padding: 6, borderRadius: 10, background: 'transparent',
                        border: 'none', cursor: 'pointer', color: '#71717a',
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                        transition: 'all 0.15s',
                    }}
                        onMouseEnter={e => { e.currentTarget.style.background = '#27272a'; e.currentTarget.style.color = '#e4e4e7'; }}
                        onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = '#71717a'; }}
                    >
                        <X size={15} />
                    </button>
                )}
            </div>

            <UploadZone onUpload={onUpload} uploading={uploading} uploadProgress={uploadProgress} />

            {!uploading && files.length > 0 && (
                <div>
                    <p style={{ fontSize: 11, color: '#52525b', fontWeight: 600, letterSpacing: '0.08em', textTransform: 'uppercase', marginBottom: 8 }}>
                        Indexed documents
                    </p>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 4, maxHeight: 200, overflowY: 'auto' }}>
                        {files.map(f => (
                            <div
                                key={f.name}
                                style={{
                                    display: 'flex', alignItems: 'center', gap: 8,
                                    padding: '6px 10px', borderRadius: 12,
                                    background: selectedFile === f.name ? 'rgba(59,130,246,0.12)' : 'transparent',
                                    border: `1px solid ${selectedFile === f.name ? 'rgba(59,130,246,0.3)' : 'transparent'}`,
                                    transition: 'all 0.15s',
                                }}
                            >
                                <button
                                    onClick={() => { onSelectFile(f.name); onClose(); }}
                                    style={{
                                        display: 'flex', alignItems: 'center', gap: 8,
                                        flex: 1, textAlign: 'left',
                                        background: 'transparent', border: 'none',
                                        cursor: 'pointer', fontSize: 13,
                                        color: selectedFile === f.name ? '#60a5fa' : '#a1a1aa',
                                        fontFamily: 'inherit',
                                    }}
                                >
                                    <FileText size={13} style={{ flexShrink: 0 }} />
                                    <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{f.name}</span>
                                    {/* Status badge */}
                                    {f.status === 'indexing' && (
                                        <span style={{ fontSize: 10, color: '#f59e0b', display: 'flex', alignItems: 'center', gap: 3, flexShrink: 0 }}>
                                            <Clock size={10} />indexing
                                        </span>
                                    )}
                                    {f.status === 'ready' && selectedFile === f.name && <CheckCircle size={13} style={{ flexShrink: 0 }} />}
                                </button>
                                {/* Reindex button */}
                                <button
                                    onClick={(e) => { e.stopPropagation(); onReindex(f.name); }}
                                    title="Re-index file"
                                    style={{
                                        padding: 5, borderRadius: 7, background: 'transparent',
                                        border: 'none', cursor: 'pointer', color: '#52525b',
                                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                                        transition: 'all 0.15s', flexShrink: 0,
                                    }}
                                    onMouseEnter={e => { e.currentTarget.style.background = '#27272a'; e.currentTarget.style.color = '#a1a1aa'; }}
                                    onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = '#52525b'; }}
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
   Page Image Viewer (lightbox / carousel)
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
                background: 'rgba(0,0,0,0.92)', backdropFilter: 'blur(12px)',
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
                {/* Header */}
                <div style={{ display: 'flex', alignItems: 'center', gap: 12, width: '100%', justifyContent: 'space-between' }}>
                    <span style={{ fontSize: 12, color: '#71717a', fontWeight: 500 }}>
                        {filename} · Page {images[current]?.page}
                        {images.length > 1 && <span style={{ color: '#52525b' }}> ({current + 1}/{images.length})</span>}
                    </span>
                    <button
                        onClick={onClose}
                        style={{ padding: 6, borderRadius: 9, background: '#27272a', border: 'none', cursor: 'pointer', color: '#a1a1aa', display: 'flex' }}
                        onMouseEnter={e => { e.currentTarget.style.background = '#3f3f46'; e.currentTarget.style.color = '#f4f4f5'; }}
                        onMouseLeave={e => { e.currentTarget.style.background = '#27272a'; e.currentTarget.style.color = '#a1a1aa'; }}
                    >
                        <X size={14} />
                    </button>
                </div>

                {/* Image */}
                <div style={{
                    position: 'relative', borderRadius: 12, overflow: 'hidden',
                    background: '#111113', border: '1px solid #27272a',
                    maxHeight: '75vh', display: 'flex', alignItems: 'center', justifyContent: 'center',
                    minWidth: 200, minHeight: 150,
                }}>
                    {!loaded[current] && !errors[current] && (
                        <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                            <Loader2 size={24} style={{ color: '#52525b', animation: 'spin 1s linear infinite' }} />
                        </div>
                    )}
                    {errors[current] ? (
                        <div style={{ padding: '24px 32px', color: '#71717a', fontSize: 13, textAlign: 'center' }}>
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

                {/* Navigation */}
                {images.length > 1 && (
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        <button onClick={prev} disabled={current === 0} style={{
                            padding: '7px 14px', borderRadius: 9, background: '#18181b',
                            border: '1px solid #27272a', color: current === 0 ? '#3f3f46' : '#a1a1aa',
                            cursor: current === 0 ? 'not-allowed' : 'pointer',
                            display: 'flex', alignItems: 'center', gap: 5, fontSize: 12,
                            fontFamily: 'inherit', transition: 'all 0.15s',
                        }}>
                            <ChevronLeft size={13} /> Prev
                        </button>
                        {/* Page pills */}
                        <div style={{ display: 'flex', gap: 4 }}>
                            {images.map((img, i) => (
                                <button
                                    key={img.page}
                                    onClick={() => setCurrent(i)}
                                    style={{
                                        width: 28, height: 28, borderRadius: 7,
                                        background: i === current ? '#3b82f6' : '#18181b',
                                        border: `1px solid ${i === current ? '#3b82f6' : '#27272a'}`,
                                        color: i === current ? 'white' : '#71717a',
                                        fontSize: 11, fontWeight: 600, cursor: 'pointer',
                                        fontFamily: 'inherit', transition: 'all 0.15s',
                                    }}
                                >
                                    {img.page}
                                </button>
                            ))}
                        </div>
                        <button onClick={next} disabled={current === images.length - 1} style={{
                            padding: '7px 14px', borderRadius: 9, background: '#18181b',
                            border: '1px solid #27272a',
                            color: current === images.length - 1 ? '#3f3f46' : '#a1a1aa',
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
   Inline Image Strip  (shown inside bot message)
───────────────────────────────────────── */
const ImageStrip = ({ images, filename, onOpenViewer }) => {
    if (!images || images.length === 0) return null;

    return (
        <div style={{
            display: 'flex', gap: 8, flexWrap: 'wrap',
            marginTop: 12, paddingTop: 12,
            borderTop: '1px solid #1e1e21',
        }}>
            {images.map((img, i) => (
                <button
                    key={img.page}
                    onClick={() => onOpenViewer(images, i)}
                    style={{
                        position: 'relative',
                        width: 72, height: 72, borderRadius: 10, overflow: 'hidden',
                        background: '#0d0d0f', border: '1px solid #27272a',
                        cursor: 'pointer', padding: 0,
                        transition: 'all 0.2s', flexShrink: 0,
                    }}
                    onMouseEnter={e => { e.currentTarget.style.borderColor = '#3b82f6'; e.currentTarget.style.transform = 'scale(1.05)'; }}
                    onMouseLeave={e => { e.currentTarget.style.borderColor = '#27272a'; e.currentTarget.style.transform = 'scale(1)'; }}
                    title={`Page ${img.page}`}
                >
                    <PageThumb src={`${API}${img.url}`} />
                    <span style={{
                        position: 'absolute', bottom: 4, right: 5,
                        fontSize: 9, fontWeight: 700, color: 'white',
                        background: 'rgba(0,0,0,0.7)', borderRadius: 4,
                        padding: '1px 4px', lineHeight: 1.4,
                    }}>
                        p.{img.page}
                    </span>
                </button>
            ))}
        </div>
    );
};

/* Tiny thumbnail with loading state */
const PageThumb = ({ src }) => {
    const [loaded, setLoaded] = useState(false);
    const [error, setError] = useState(false);
    return (
        <>
            {!loaded && !error && (
                <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#0d0d0f' }}>
                    <Loader2 size={14} style={{ color: '#3f3f46', animation: 'spin 1s linear infinite' }} />
                </div>
            )}
            {error ? (
                <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#0d0d0f' }}>
                    <Image size={14} style={{ color: '#3f3f46', opacity: 0.5 }} />
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

    useEffect(() => {
        if (!filename || !open) return;
        setLoading(true);
        axios.get(`${API}/page-images/${encodeURIComponent(filename)}`)
            .then(res => setPages(res.data.images || []))
            .catch(() => setPages([]))
            .finally(() => setLoading(false));
    }, [filename, open]);

    const [viewerImages, setViewerImages] = useState(null);
    const [viewerStart, setViewerStart] = useState(0);

    return (
        <>
            {viewerImages && (
                <PageImageViewer
                    images={viewerImages}
                    filename={filename}
                    onClose={() => setViewerImages(null)}
                />
            )}
            <div style={{
                position: 'absolute', right: 0, top: 0, bottom: 0,
                width: open ? 180 : 0,
                overflow: 'hidden',
                background: '#0d0d0f',
                borderLeft: open ? '1px solid #1e1e21' : 'none',
                transition: 'width 0.25s cubic-bezier(0.4,0,0.2,1)',
                zIndex: 40, flexShrink: 0,
                display: 'flex', flexDirection: 'column',
            }}>
                <div style={{
                    padding: '12px 14px 8px',
                    borderBottom: '1px solid #1e1e21',
                    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                    flexShrink: 0,
                }}>
                    <span style={{ fontSize: 11, color: '#52525b', fontWeight: 600, letterSpacing: '0.08em', textTransform: 'uppercase' }}>
                        Pages
                    </span>
                    <button onClick={onClose} style={{ padding: 4, borderRadius: 6, background: 'transparent', border: 'none', cursor: 'pointer', color: '#52525b', display: 'flex' }}
                        onMouseEnter={e => { e.currentTarget.style.color = '#a1a1aa'; }}
                        onMouseLeave={e => { e.currentTarget.style.color = '#52525b'; }}>
                        <X size={12} />
                    </button>
                </div>

                <div style={{ flex: 1, overflowY: 'auto', padding: '10px 10px', display: 'flex', flexDirection: 'column', gap: 8 }}>
                    {loading && (
                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '20px 0' }}>
                            <Loader2 size={18} style={{ color: '#52525b', animation: 'spin 1s linear infinite' }} />
                        </div>
                    )}
                    {!loading && pages.length === 0 && (
                        <p style={{ fontSize: 11, color: '#3f3f46', textAlign: 'center', padding: '20px 0' }}>No page images</p>
                    )}
                    {pages.map((pg, i) => (
                        <button
                            key={pg.page}
                            onClick={() => { setViewerImages(pages); setViewerStart(i); }}
                            style={{
                                position: 'relative', width: '100%', paddingBottom: '133%',
                                borderRadius: 8, overflow: 'hidden',
                                background: '#111113', border: '1px solid #27272a',
                                cursor: 'pointer', padding: 0, flexShrink: 0,
                                transition: 'border-color 0.15s',
                            }}
                            onMouseEnter={e => e.currentTarget.style.borderColor = '#3b82f6'}
                            onMouseLeave={e => e.currentTarget.style.borderColor = '#27272a'}
                        >
                            <div style={{ position: 'absolute', inset: 0 }}>
                                <PageThumb src={`${API}${pg.url}`} />
                            </div>
                            <span style={{
                                position: 'absolute', bottom: 4, left: '50%',
                                transform: 'translateX(-50%)',
                                fontSize: 9, fontWeight: 700, color: 'white',
                                background: 'rgba(0,0,0,0.7)', borderRadius: 4,
                                padding: '1px 6px', whiteSpace: 'nowrap',
                            }}>
                                {pg.page}
                            </span>
                        </button>
                    ))}
                </div>
            </div>

            {/* Viewer from sidebar */}
            {viewerImages && (
                <PageImageViewer
                    images={viewerImages}
                    filename={filename}
                    onClose={() => setViewerImages(null)}
                />
            )}
        </>
    );
};

/* ─────────────────────────────────────────
   LaTeX delimiter normaliser
───────────────────────────────────────── */
function normaliseContent(text) {
    text = text.replace(/\\\[([\s\S]*?)\\\]/g, (_, i) => `\n$$${i}$$\n`);
    text = text.replace(/\\\(([\s\S]*?)\\\)/g, (_, i) => `$${i}$`);
    text = text.replace(/(\$[^$\n]+?\$)\s*\1/g, '$1');
    text = text.replace(/<br\s*\/?>/gi, ' · ');
    return text;
}

/* ─────────────────────────────────────────
   Markdown + Math renderer
───────────────────────────────────────── */
const MarkdownMessage = ({ content }) => (
    <ReactMarkdown
        remarkPlugins={[remarkGfm, remarkMath]}
        rehypePlugins={[rehypeRaw, [rehypeKatex, { strict: false, throwOnError: false }]]}
        components={{
            div: ({ className, children, ...props }) => {
                if (className?.includes('math-display')) return (
                    <div style={{ margin: '12px 0', padding: '16px 20px', background: '#0d1117', border: '1px solid rgba(59,130,246,0.2)', borderRadius: 12, overflowX: 'auto', textAlign: 'center' }} {...props}>{children}</div>
                );
                return <div className={className} {...props}>{children}</div>;
            },
            span: ({ className, children, ...props }) => {
                if (className?.includes('math-inline')) return (
                    <span style={{ padding: '1px 5px', borderRadius: 6, background: 'rgba(59,130,246,0.12)', color: '#93c5fd', fontFamily: 'monospace', fontSize: '0.875em' }} {...props}>{children}</span>
                );
                return <span className={className} {...props}>{children}</span>;
            },
            table: ({ ...props }) => (
                <div style={{ overflowX: 'auto', margin: '12px 0' }}>
                    <table style={{ borderCollapse: 'collapse', fontSize: 13, width: '100%' }} {...props} />
                </div>
            ),
            thead: ({ ...props }) => <thead style={{ background: 'rgba(63,63,70,0.6)' }} {...props} />,
            th: ({ ...props }) => <th style={{ border: '1px solid #3f3f46', padding: '8px 14px', textAlign: 'left', fontWeight: 600, color: '#e4e4e7', fontSize: 12 }} {...props} />,
            td: ({ ...props }) => <td style={{ border: '1px solid #2d2d30', padding: '7px 14px', color: '#a1a1aa' }} {...props} />,
            tr: ({ ...props }) => <tr {...props} />,
            code: ({ inline, children, ...props }) => inline
                ? <code style={{ background: 'rgba(63,63,70,0.7)', padding: '2px 7px', borderRadius: 6, color: '#7dd3fc', fontSize: '0.85em', fontFamily: '"JetBrains Mono", "Fira Code", monospace' }} {...props}>{children}</code>
                : <pre style={{ background: '#111113', border: '1px solid #2d2d30', borderRadius: 12, padding: '16px 20px', overflowX: 'auto', margin: '10px 0' }}>
                    <code style={{ color: '#86efac', fontSize: '0.82em', fontFamily: '"JetBrains Mono", "Fira Code", monospace', lineHeight: 1.7 }} {...props}>{children}</code>
                </pre>,
            h1: ({ ...props }) => <h1 style={{ fontSize: 20, fontWeight: 700, color: '#f4f4f5', margin: '16px 0 6px' }} {...props} />,
            h2: ({ ...props }) => <h2 style={{ fontSize: 17, fontWeight: 600, color: '#e4e4e7', margin: '14px 0 5px' }} {...props} />,
            h3: ({ ...props }) => <h3 style={{ fontSize: 15, fontWeight: 600, color: '#d4d4d8', margin: '12px 0 4px' }} {...props} />,
            ul: ({ ...props }) => <ul style={{ paddingLeft: 20, margin: '8px 0', display: 'flex', flexDirection: 'column', gap: 4 }} {...props} />,
            ol: ({ ...props }) => <ol style={{ paddingLeft: 20, margin: '8px 0', display: 'flex', flexDirection: 'column', gap: 4 }} {...props} />,
            li: ({ ...props }) => <li style={{ color: '#a1a1aa', lineHeight: 1.65 }} {...props} />,
            p: ({ ...props }) => <p style={{ margin: '0 0 10px', color: '#d4d4d8', lineHeight: 1.7, fontSize: 14 }} {...props} />,
            strong: ({ ...props }) => <strong style={{ fontWeight: 600, color: '#f4f4f5' }} {...props} />,
            em: ({ ...props }) => <em style={{ fontStyle: 'italic', color: '#a1a1aa' }} {...props} />,
            blockquote: ({ ...props }) => <blockquote style={{ borderLeft: '3px solid #3b82f6', paddingLeft: 16, margin: '10px 0', color: '#71717a', fontStyle: 'italic' }} {...props} />,
            a: ({ ...props }) => <a style={{ color: '#60a5fa', textDecoration: 'underline', textUnderlineOffset: 3 }} target="_blank" rel="noopener noreferrer" {...props} />,
        }}
    >
        {normaliseContent(content)}
    </ReactMarkdown>
);

/* ─────────────────────────────────────────
   Typing dots
───────────────────────────────────────── */
const TypingDots = () => (
    <div style={{ display: 'flex', gap: 5, alignItems: 'center', padding: '4px 0' }}>
        {[0, 150, 300].map((delay, i) => (
            <span key={i} style={{
                width: 7, height: 7, borderRadius: '50%',
                background: '#52525b',
                animation: `bounce 1.2s ease-in-out ${delay}ms infinite`,
                display: 'block',
            }} />
        ))}
    </div>
);

/* ─────────────────────────────────────────
   FileOption — dropdown item
───────────────────────────────────────── */
const FileOption = ({ name, status, selected, onSelect }) => (
    <button
        className="file-option"
        onClick={onSelect}
        style={{
            width: '100%', textAlign: 'left',
            padding: '9px 14px', fontSize: 13,
            display: 'flex', alignItems: 'center', gap: 9,
            background: selected ? 'rgba(59,130,246,0.1)' : 'transparent',
            color: selected ? '#60a5fa' : '#a1a1aa',
            border: 'none', cursor: 'pointer',
            fontFamily: 'inherit', transition: 'background 0.1s, color 0.1s',
        }}
    >
        <FileText size={12} style={{ flexShrink: 0 }} />
        <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{name}</span>
        {status === 'indexing' && <Clock size={11} style={{ color: '#f59e0b', flexShrink: 0 }} />}
        {selected && status !== 'indexing' && <CheckCircle size={12} style={{ flexShrink: 0 }} />}
    </button>
);

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
    // files is now [{name, status}]
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
    // Lightbox state
    const [viewerImages, setViewerImages] = useState(null);
    const [viewerStart, setViewerStart] = useState(0);

    const messagesEndRef = useRef(null);
    const scrollContainerRef = useRef(null);
    const textareaRef = useRef(null);
    const isAtBottomRef = useRef(true);

    /* ── Scroll helpers ── */
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

    // Poll indexing status for files that are still being indexed
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
                    } catch {
                        return f;
                    }
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
            // Backend returns [{name, status}] in v3
            const list = raw.map(f => (typeof f === 'string' ? { name: f, status: 'ready' } : { name: f.name, status: f.status || 'ready' }));
            setFiles(list);
            if (list.length > 0 && !selectedFile) setSelectedFile(list[0].name);
        } catch (e) { console.error('Failed to fetch files:', e); }
    };

    /* ── Reindex ── */
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

    /* ── Upload ── */
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

    /* ── Open image viewer from a message's image strip ── */
    const openViewer = useCallback((images, startIdx = 0) => {
        setViewerImages(images);
        setViewerStart(startIdx);
    }, []);

    /* ── Send message ── */
    const handleSend = async () => {
        if (!inputValue.trim()) return;
        if (!selectedFile) {
            setMessages(prev => [...prev, {
                id: Date.now(), type: 'bot',
                content: '⚠️ Please upload or select a file first.',
                timestamp: new Date(), images: [],
            }]);
            return;
        }

        const userMsg = { id: Date.now(), type: 'user', content: inputValue, timestamp: new Date() };
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

                        // ── v3: handle image metadata event ──
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

    return (
        <>
            <style>{`
                @import url('https://fonts.googleapis.com/css2?family=Geist:wght@300;400;500;600&family=Geist+Mono:wght@400;500&display=swap');

                * { box-sizing: border-box; margin: 0; padding: 0; }

                ::-webkit-scrollbar { width: 4px; height: 4px; }
                ::-webkit-scrollbar-track { background: transparent; }
                ::-webkit-scrollbar-thumb { background: #3f3f46; border-radius: 99px; }
                ::-webkit-scrollbar-thumb:hover { background: #52525b; }

                @keyframes spin { to { transform: rotate(360deg); } }
                @keyframes bounce {
                    0%, 80%, 100% { transform: translateY(0); opacity: 0.4; }
                    40% { transform: translateY(-5px); opacity: 1; }
                }
                @keyframes shimmer {
                    0% { opacity: 0.6; }
                    50% { opacity: 1; }
                    100% { opacity: 0.6; }
                }
                @keyframes modalIn {
                    from { opacity: 0; transform: scale(0.94) translateY(8px); }
                    to   { opacity: 1; transform: scale(1)    translateY(0); }
                }
                @keyframes fadeSlideUp {
                    from { opacity: 0; transform: translateY(10px); }
                    to   { opacity: 1; transform: translateY(0); }
                }
                @keyframes fadeIn {
                    from { opacity: 0; }
                    to   { opacity: 1; }
                }
                @keyframes scrollBtnIn {
                    from { opacity: 0; transform: translateX(-50%) translateY(8px); }
                    to   { opacity: 1; transform: translateX(-50%) translateY(0); }
                }

                .msg-bot { animation: fadeSlideUp 0.25s ease forwards; }
                .msg-user { animation: fadeSlideUp 0.18s ease forwards; }

                .send-btn:not(:disabled):hover { background: #2563eb !important; }
                .send-btn:not(:disabled):active { transform: scale(0.93); }

                .input-area:focus-within { border-color: #3b82f6 !important; box-shadow: 0 0 0 3px rgba(59,130,246,0.12) !important; }

                .file-chip:hover { background: rgba(59,130,246,0.15) !important; }
                .file-option:not([data-selected="true"]):hover { background: #27272a !important; color: #e4e4e7 !important; }
            `}</style>

            <div style={{
                position: 'relative', display: 'flex', flexDirection: 'column',
                height: '100vh', background: '#09090b',
                fontFamily: '"Geist", -apple-system, BlinkMacSystemFont, sans-serif',
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
                    <PageImageViewer
                        images={viewerImages}
                        filename={selectedFile}
                        onClose={() => setViewerImages(null)}
                    />
                )}

                {/* ── Top Bar ── */}
                <div style={{
                    borderBottom: '1px solid #18181b',
                    padding: '0 20px',
                    height: 56,
                    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                    flexShrink: 0,
                    background: 'rgba(9,9,11,0.95)',
                    backdropFilter: 'blur(12px)',
                    position: 'sticky', top: 0, zIndex: 100,
                }}>
                    {/* Logo */}
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                        <div style={{
                            width: 32, height: 32, borderRadius: 10,
                            background: 'linear-gradient(135deg, #ef4444, #dc2626)',
                            display: 'flex', alignItems: 'center', justifyContent: 'center',
                            boxShadow: '0 2px 12px rgba(239,68,68,0.35)',
                            flexShrink: 0,
                        }}>
                            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                                <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
                            </svg>
                        </div>
                        <div>
                            <p style={{ fontSize: 14, fontWeight: 600, color: '#f4f4f5', lineHeight: 1 }}>CMTI Bot</p>
                            <p style={{ fontSize: 10, color: '#52525b', lineHeight: 1, marginTop: 2 }}>AI Document Assistant</p>
                        </div>
                    </div>

                    {/* Right controls */}
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        {/* New Chat */}
                        <button
                            onClick={() => {
                                setMessages([{ id: 1, type: 'bot', content: 'Hello! Upload a PDF or TXT file and start asking questions about it.', timestamp: new Date(), images: [] }]);
                                setInputValue('');
                                setUserScrolled(false);
                            }}
                            style={{
                                display: 'flex', alignItems: 'center', gap: 6,
                                background: 'transparent', border: '1px solid #27272a',
                                color: '#a1a1aa', padding: '6px 12px', borderRadius: 9,
                                fontSize: 12, fontWeight: 500, cursor: 'pointer',
                                transition: 'all 0.15s', fontFamily: 'inherit',
                            }}
                            onMouseEnter={e => { e.currentTarget.style.borderColor = '#3f3f46'; e.currentTarget.style.color = '#e4e4e7'; e.currentTarget.style.background = '#18181b'; }}
                            onMouseLeave={e => { e.currentTarget.style.borderColor = '#27272a'; e.currentTarget.style.color = '#a1a1aa'; e.currentTarget.style.background = 'transparent'; }}
                        >
                            <Plus size={13} />
                            <span style={{ display: window.innerWidth < 480 ? 'none' : 'inline' }}>New chat</span>
                        </button>

                        {selectedFile && (
                            <button
                                onClick={() => setShowReport(s => !s)}
                                style={{
                                    display: 'flex', alignItems: 'center', gap: 6,
                                    background: showReport ? '#27272a' : '#18181b', border: '1px solid #27272a',
                                    color: showReport ? '#e4e4e7' : '#a1a1aa', padding: '6px 12px', borderRadius: 9,
                                    fontSize: 12, fontWeight: 500, cursor: 'pointer',
                                    transition: 'all 0.15s', fontFamily: 'inherit',
                                }}
                                onMouseEnter={e => { e.currentTarget.style.background = '#27272a'; e.currentTarget.style.color = '#e4e4e7'; }}
                                onMouseLeave={e => { if (!showReport) { e.currentTarget.style.background = '#18181b'; e.currentTarget.style.color = '#a1a1aa'; } }}
                            >
                                <FileText size={13} />
                                <span style={{ display: window.innerWidth < 480 ? 'none' : 'inline' }}>Report</span>
                            </button>
                        )}

                        {/* Page thumbnails toggle */}
                        {selectedFile && (
                            <button
                                onClick={() => setShowSidebar(s => !s)}
                                title="View all pages"
                                style={{
                                    display: 'flex', alignItems: 'center', gap: 6,
                                    background: showSidebar ? '#27272a' : '#18181b', border: '1px solid #27272a',
                                    color: showSidebar ? '#e4e4e7' : '#a1a1aa', padding: '6px 12px', borderRadius: 9,
                                    fontSize: 12, fontWeight: 500, cursor: 'pointer',
                                    transition: 'all 0.15s', fontFamily: 'inherit',
                                }}
                                onMouseEnter={e => { e.currentTarget.style.borderColor = '#3f3f46'; e.currentTarget.style.color = '#e4e4e7'; e.currentTarget.style.background = '#27272a'; }}
                                onMouseLeave={e => { if (!showSidebar) { e.currentTarget.style.borderColor = '#27272a'; e.currentTarget.style.color = '#a1a1aa'; e.currentTarget.style.background = '#18181b'; } }}
                            >
                                <LayoutGrid size={13} />
                                <span style={{ display: window.innerWidth < 480 ? 'none' : 'inline' }}>Pages</span>
                            </button>
                        )}

                        {/* Upload btn */}
                        <button
                            onClick={() => setShowUploadPanel(true)}
                            disabled={uploading}
                            style={{
                                display: 'flex', alignItems: 'center', gap: 6,
                                background: '#18181b', border: '1px solid #27272a',
                                color: '#a1a1aa', padding: '6px 12px', borderRadius: 9,
                                fontSize: 12, fontWeight: 500, cursor: uploading ? 'wait' : 'pointer',
                                transition: 'all 0.15s', opacity: uploading ? 0.6 : 1,
                                fontFamily: 'inherit',
                            }}
                            onMouseEnter={e => { if (!uploading) { e.currentTarget.style.borderColor = '#3f3f46'; e.currentTarget.style.color = '#e4e4e7'; } }}
                            onMouseLeave={e => { e.currentTarget.style.borderColor = '#27272a'; e.currentTarget.style.color = '#a1a1aa'; }}
                        >
                            {uploading
                                ? <Loader2 size={13} style={{ color: '#60a5fa', animation: 'spin 1s linear infinite' }} />
                                : <Upload size={13} style={{ color: '#60a5fa' }} />
                            }
                            <span style={{ display: window.innerWidth < 480 ? 'none' : 'inline' }}>{uploading ? 'Indexing…' : 'Upload'}</span>
                        </button>

                        {/* File selector dropdown */}
                        <div style={{ position: 'relative' }}>
                            {showDropdown && (
                                <div
                                    style={{ position: 'fixed', inset: 0, zIndex: 1 }}
                                    onClick={() => setShowDropdown(false)}
                                />
                            )}

                            <button
                                onClick={() => setShowDropdown(prev => !prev)}
                                style={{
                                    position: 'relative', zIndex: 3,
                                    display: 'flex', alignItems: 'center', gap: 7,
                                    background: showDropdown ? '#27272a' : '#18181b',
                                    border: '1px solid #27272a',
                                    color: '#d4d4d8', padding: '6px 12px', borderRadius: 9,
                                    fontSize: 12, fontWeight: 500, cursor: 'pointer',
                                    transition: 'all 0.15s', fontFamily: 'inherit',
                                    maxWidth: 200,
                                }}
                            >
                                <FileText size={13} style={{ color: '#60a5fa', flexShrink: 0 }} />
                                <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1, maxWidth: 130 }}>
                                    {selectedFile || 'No file'}
                                </span>
                                {/* Show indexing spinner next to selected file name if it's still indexing */}
                                {files.find(f => f.name === selectedFile)?.status === 'indexing' && (
                                    <Clock size={11} style={{ color: '#f59e0b', flexShrink: 0 }} />
                                )}
                                <ChevronDown size={12} style={{ color: '#52525b', flexShrink: 0, transform: showDropdown ? 'rotate(180deg)' : 'rotate(0)', transition: 'transform 0.2s' }} />
                            </button>

                            {showDropdown && (
                                <div style={{
                                    position: 'absolute', right: 0, top: 'calc(100% + 6px)',
                                    width: 280, background: '#18181b',
                                    border: '1px solid #27272a', borderRadius: 12,
                                    boxShadow: '0 16px 48px rgba(0,0,0,0.6)',
                                    zIndex: 2, overflow: 'hidden',
                                    animation: 'fadeIn 0.15s ease',
                                }}>
                                    {files.length === 0
                                        ? <p style={{ color: '#52525b', fontSize: 13, padding: '12px 16px' }}>No files indexed yet</p>
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

                {/* ── Main area with optional sidebar ── */}
                <div style={{ flex: 1, position: 'relative', overflow: 'hidden', display: 'flex' }}>

                    {/* ── Empty state ── */}
                    {files.length === 0 && messages.length <= 1 && (
                        <div style={{
                            flex: 1, display: 'flex', flexDirection: 'column',
                            alignItems: 'center', justifyContent: 'center',
                            gap: 20, padding: '0 24px',
                            animation: 'fadeSlideUp 0.4s ease',
                        }}>
                            <div style={{
                                width: 56, height: 56, borderRadius: 16,
                                background: '#18181b', border: '1px solid #27272a',
                                display: 'flex', alignItems: 'center', justifyContent: 'center',
                            }}>
                                <Sparkles size={24} style={{ color: '#52525b' }} />
                            </div>
                            <div style={{ textAlign: 'center' }}>
                                <p style={{ fontSize: 16, fontWeight: 600, color: '#e4e4e7' }}>No documents yet</p>
                                <p style={{ fontSize: 13, color: '#52525b', marginTop: 5 }}>Upload a PDF or TXT to start asking questions</p>
                            </div>
                            <button
                                onClick={() => setShowUploadPanel(true)}
                                style={{
                                    display: 'flex', alignItems: 'center', gap: 8,
                                    background: '#3b82f6', color: 'white',
                                    padding: '10px 20px', borderRadius: 12,
                                    fontSize: 13, fontWeight: 500,
                                    border: 'none', cursor: 'pointer',
                                    fontFamily: 'inherit', transition: 'background 0.15s',
                                }}
                                onMouseEnter={e => e.currentTarget.style.background = '#2563eb'}
                                onMouseLeave={e => e.currentTarget.style.background = '#3b82f6'}
                            >
                                <Upload size={14} />
                                Upload a document
                            </button>
                        </div>
                    )}

                    {/* ── Messages ── */}
                    {(files.length > 0 || messages.length > 1) && (
                        <div
                            ref={scrollContainerRef}
                            onScroll={handleScroll}
                            style={{
                                flex: 1, overflowY: 'auto',
                                padding: '32px 20px',
                                display: 'flex', flexDirection: 'column',
                            }}
                        >
                            <div style={{ maxWidth: 740, width: '100%', margin: '0 auto', display: 'flex', flexDirection: 'column', gap: 24 }}>
                                {messages.map((msg, idx) => (
                                    <div
                                        key={msg.id}
                                        className={msg.type === 'user' ? 'msg-user' : 'msg-bot'}
                                        style={{
                                            display: 'flex',
                                            justifyContent: msg.type === 'user' ? 'flex-end' : 'flex-start',
                                            animationDelay: `${Math.min(idx * 0.03, 0.2)}s`,
                                            animationFillMode: 'both',
                                        }}
                                    >
                                        {msg.type === 'user' ? (
                                            <div style={{
                                                maxWidth: '78%',
                                                background: '#1d4ed8',
                                                color: '#eff6ff',
                                                padding: '11px 16px',
                                                borderRadius: '18px 18px 4px 18px',
                                                fontSize: 14, lineHeight: 1.65,
                                                boxShadow: '0 2px 12px rgba(29,78,216,0.3)',
                                            }}>
                                                {msg.content}
                                            </div>
                                        ) : (
                                            <div style={{ display: 'flex', gap: 12, maxWidth: '100%', alignItems: 'flex-start' }}>
                                                <div style={{
                                                    width: 30, height: 30, borderRadius: 10, flexShrink: 0,
                                                    background: 'linear-gradient(135deg, #ef4444, #dc2626)',
                                                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                                                    fontSize: 11, fontWeight: 700, color: 'white',
                                                    boxShadow: '0 2px 8px rgba(239,68,68,0.25)',
                                                    marginTop: 2,
                                                }}>
                                                    AI
                                                </div>
                                                <div style={{
                                                    flex: 1,
                                                    background: '#111113',
                                                    border: '1px solid #1e1e21',
                                                    padding: '13px 16px',
                                                    borderRadius: '4px 18px 18px 18px',
                                                    minWidth: 0,
                                                }}>
                                                    {msg.content
                                                        ? <MarkdownMessage content={msg.content} />
                                                        : isTyping && idx === messages.length - 1
                                                            ? <TypingDots />
                                                            : null
                                                    }
                                                    {/* ── v3: inline image strip ── */}
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
                            position: 'absolute', right: showSidebar ? 180 : 0, top: 0, bottom: 0,
                            width: 460, overflowY: 'auto',
                            background: '#0d0d0f',
                            borderLeft: '1px solid #1e1e21',
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
                            bottom: 100, left: '50%',
                            transform: 'translateX(-50%)',
                            zIndex: 25,
                            display: 'flex', alignItems: 'center', gap: 6,
                            background: '#18181b',
                            border: '1px solid #3f3f46',
                            color: '#a1a1aa',
                            padding: '7px 14px', borderRadius: 99,
                            fontSize: 12, fontWeight: 500,
                            cursor: 'pointer', fontFamily: 'inherit',
                            boxShadow: '0 4px 20px rgba(0,0,0,0.4)',
                            animation: 'scrollBtnIn 0.2s cubic-bezier(0.34,1.56,0.64,1)',
                            transition: 'all 0.15s',
                            whiteSpace: 'nowrap',
                        }}
                        onMouseEnter={e => { e.currentTarget.style.background = '#27272a'; e.currentTarget.style.color = '#e4e4e7'; e.currentTarget.style.borderColor = '#52525b'; }}
                        onMouseLeave={e => { e.currentTarget.style.background = '#18181b'; e.currentTarget.style.color = '#a1a1aa'; e.currentTarget.style.borderColor = '#3f3f46'; }}
                    >
                        <ArrowDown size={13} />
                        Scroll to bottom
                    </button>
                )}

                {/* ── Input Bar ── */}
                <div style={{
                    borderTop: '1px solid #18181b',
                    padding: '12px 20px 16px',
                    flexShrink: 0,
                    background: 'rgba(9,9,11,0.97)',
                    backdropFilter: 'blur(12px)',
                }}>
                    {/* Active file chip */}
                    {selectedFile && (
                        <div style={{ maxWidth: 740, margin: '0 auto 8px' }}>
                            <span
                                className="file-chip"
                                style={{
                                    display: 'inline-flex', alignItems: 'center', gap: 6,
                                    background: 'rgba(59,130,246,0.1)', border: '1px solid rgba(59,130,246,0.2)',
                                    color: '#93c5fd', fontSize: 11, fontWeight: 500,
                                    padding: '4px 10px', borderRadius: 99,
                                    cursor: 'pointer', transition: 'all 0.15s',
                                }}
                                onClick={() => setShowUploadPanel(true)}
                            >
                                <FileText size={11} />
                                {selectedFile}
                                {files.find(f => f.name === selectedFile)?.status === 'indexing' && (
                                    <span style={{ display: 'flex', alignItems: 'center', gap: 3, color: '#f59e0b' }}>
                                        <Clock size={10} /> indexing…
                                    </span>
                                )}
                            </span>
                        </div>
                    )}

                    {/* Textarea + buttons */}
                    <div style={{ maxWidth: 740, margin: '0 auto' }}>
                        <div
                            className="input-area"
                            style={{
                                display: 'flex', alignItems: 'flex-end', gap: 8,
                                background: '#111113', border: '1px solid #27272a',
                                borderRadius: 16, padding: '8px 8px 8px 14px',
                                transition: 'border-color 0.2s, box-shadow 0.2s',
                            }}
                        >
                            {/* Attach */}
                            <button
                                onClick={() => setShowUploadPanel(true)}
                                disabled={uploading}
                                style={{
                                    padding: 8, borderRadius: 9, background: 'transparent',
                                    border: 'none', cursor: uploading ? 'wait' : 'pointer',
                                    color: '#52525b', flexShrink: 0, opacity: uploading ? 0.5 : 1,
                                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                                    transition: 'all 0.15s', marginBottom: 1,
                                }}
                                onMouseEnter={e => { if (!uploading) { e.currentTarget.style.color = '#a1a1aa'; e.currentTarget.style.background = '#1e1e21'; } }}
                                onMouseLeave={e => { e.currentTarget.style.color = '#52525b'; e.currentTarget.style.background = 'transparent'; }}
                            >
                                {uploading
                                    ? <Loader2 size={17} style={{ color: '#60a5fa', animation: 'spin 1s linear infinite' }} />
                                    : <Paperclip size={17} />
                                }
                            </button>

                            {/* Textarea */}
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
                                    fontSize: 14, lineHeight: 1.6, fontFamily: 'inherit',
                                    padding: '5px 0', maxHeight: 160, overflowY: 'auto',
                                }}
                            />

                            {/* Send */}
                            <button
                                className="send-btn"
                                onClick={handleSend}
                                disabled={!inputValue.trim() || !selectedFile || uploading}
                                style={{
                                    width: 34, height: 34, borderRadius: 9, flexShrink: 0,
                                    background: inputValue.trim() && selectedFile && !uploading ? '#3b82f6' : '#1e1e21',
                                    border: 'none', cursor: inputValue.trim() && selectedFile && !uploading ? 'pointer' : 'not-allowed',
                                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                                    color: inputValue.trim() && selectedFile && !uploading ? 'white' : '#3f3f46',
                                    transition: 'all 0.15s',
                                    marginBottom: 1,
                                }}
                            >
                                <Send size={15} />
                            </button>
                        </div>

                        <p style={{ fontSize: 11, color: '#3f3f46', textAlign: 'center', marginTop: 8 }}>
                            Answers are grounded in the selected document only
                        </p>
                    </div>
                </div>
            </div>
        </>
    );
};

export default Chatbot;