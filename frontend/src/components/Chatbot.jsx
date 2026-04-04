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
                border: `1.5px dashed ${dragging ? '#c8a96e' : '#2a2a30'}`,
                borderRadius: '10px',
                padding: '36px 24px',
                cursor: uploading ? 'wait' : 'pointer',
                transition: 'all 0.2s ease',
                background: dragging ? 'rgba(200,169,110,0.05)' : 'rgba(13,13,16,0.8)',
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
                width: 44, height: 44, borderRadius: 10,
                background: dragging ? 'rgba(200,169,110,0.12)' : '#17171b',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                transition: 'all 0.2s',
                border: `1px solid ${dragging ? 'rgba(200,169,110,0.4)' : '#252530'}`,
            }}>
                {uploading
                    ? <Loader2 size={20} style={{ color: '#c8a96e', animation: 'spin 1s linear infinite' }} />
                    : <FileUp size={20} style={{ color: dragging ? '#c8a96e' : '#3e3e48' }} />
                }
            </div>
            <div style={{ textAlign: 'center' }}>
                <p style={{ fontSize: 13, fontWeight: 400, color: '#c8c6c1', margin: 0, fontFamily: "'DM Mono', monospace", letterSpacing: '0.01em' }}>
                    {uploading ? uploadProgress : dragging ? 'Drop to upload' : 'Drop file here'}
                </p>
                <p style={{ fontSize: 11.5, color: '#3e3e48', marginTop: 4, fontFamily: "'DM Mono', monospace", letterSpacing: '0.02em' }}>
                    {uploading ? 'Processing… this may take a moment' : 'click to browse · PDF & TXT supported'}
                </p>
            </div>
            {uploading && (
                <div style={{ width: '100%', height: 1, background: '#1e1e22', borderRadius: 99, overflow: 'hidden' }}>
                    <div style={{ height: '100%', background: 'linear-gradient(90deg, #c8a96e, #d4b880)', borderRadius: 99, animation: 'shimmer 1.5s ease-in-out infinite', width: '100%' }} />
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
            background: 'rgba(0,0,0,0.8)', backdropFilter: 'blur(10px)',
        }}
        onClick={() => !uploading && onClose()}
    >
        <div
            style={{
                position: 'relative', width: '100%', maxWidth: 400,
                margin: '0 16px',
                background: '#0e0e10',
                border: '1px solid #1e1e22',
                borderRadius: 12, padding: 22,
                display: 'flex', flexDirection: 'column', gap: 18,
                boxShadow: '0 32px 80px rgba(0,0,0,0.8)',
                animation: 'modalIn 0.22s cubic-bezier(0.34,1.56,0.64,1)',
                fontFamily: "'DM Mono', monospace",
            }}
            onClick={e => e.stopPropagation()}
        >
            <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between' }}>
                <div>
                    <h2 style={{ fontSize: 14, fontWeight: 500, color: '#e8e6e1', margin: 0, fontFamily: "'Fraunces', serif", fontStyle: 'italic' }}>Upload Document</h2>
                    <p style={{ fontSize: 11, color: '#3e3e48', marginTop: 4, letterSpacing: '0.04em', textTransform: 'uppercase' }}>PDF or TXT · indexed automatically</p>
                </div>
                {!uploading && (
                    <button onClick={onClose} style={{
                        padding: 6, borderRadius: 6, background: 'transparent',
                        border: '1px solid #252530', cursor: 'pointer', color: '#3e3e48',
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                        transition: 'all 0.15s',
                    }}
                        onMouseEnter={e => { e.currentTarget.style.background = '#17171b'; e.currentTarget.style.color = '#c8c6c1'; e.currentTarget.style.borderColor = '#3a3a48'; }}
                        onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = '#3e3e48'; e.currentTarget.style.borderColor = '#252530'; }}
                    >
                        <X size={13} />
                    </button>
                )}
            </div>

            <UploadZone onUpload={onUpload} uploading={uploading} uploadProgress={uploadProgress} />

            {!uploading && files.length > 0 && (
                <div>
                    <p style={{ fontSize: 10, color: '#3e3e48', fontWeight: 400, letterSpacing: '0.08em', textTransform: 'uppercase', marginBottom: 8 }}>
                        Indexed documents
                    </p>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 2, maxHeight: 200, overflowY: 'auto' }}>
                        {files.map(f => (
                            <div
                                key={f.name}
                                style={{
                                    display: 'flex', alignItems: 'center', gap: 8,
                                    padding: '7px 10px', borderRadius: 6,
                                    background: selectedFile === f.name ? 'rgba(200,169,110,0.08)' : 'transparent',
                                    border: `1px solid ${selectedFile === f.name ? 'rgba(200,169,110,0.2)' : 'transparent'}`,
                                    transition: 'all 0.15s',
                                }}
                            >
                                <button
                                    onClick={() => { onSelectFile(f.name); onClose(); }}
                                    style={{
                                        display: 'flex', alignItems: 'center', gap: 8,
                                        flex: 1, textAlign: 'left',
                                        background: 'transparent', border: 'none',
                                        cursor: 'pointer', fontSize: 12,
                                        color: selectedFile === f.name ? '#c8a96e' : '#6e6e78',
                                        fontFamily: "'DM Mono', monospace",
                                        letterSpacing: '0.01em',
                                    }}
                                >
                                    <FileText size={11} style={{ flexShrink: 0 }} />
                                    <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{f.name}</span>
                                    {f.status === 'indexing' && (
                                        <span style={{ fontSize: 10, color: '#8a7040', display: 'flex', alignItems: 'center', gap: 3, flexShrink: 0 }}>
                                            <Clock size={9} />indexing
                                        </span>
                                    )}
                                    {f.status === 'ready' && selectedFile === f.name && <CheckCircle size={11} style={{ flexShrink: 0, color: '#c8a96e' }} />}
                                </button>
                                <button
                                    onClick={(e) => { e.stopPropagation(); onReindex(f.name); }}
                                    title="Re-index file"
                                    style={{
                                        padding: 5, borderRadius: 5, background: 'transparent',
                                        border: '1px solid transparent', cursor: 'pointer', color: '#3e3e48',
                                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                                        transition: 'all 0.15s', flexShrink: 0,
                                    }}
                                    onMouseEnter={e => { e.currentTarget.style.background = '#17171b'; e.currentTarget.style.color = '#6e6e78'; e.currentTarget.style.borderColor = '#252530'; }}
                                    onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = '#3e3e48'; e.currentTarget.style.borderColor = 'transparent'; }}
                                >
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
                background: 'rgba(0,0,0,0.95)', backdropFilter: 'blur(14px)',
                display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
                fontFamily: "'DM Mono', monospace",
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
                    <span style={{ fontSize: 11, color: '#4e4e58', letterSpacing: '0.04em' }}>
                        {filename} · Page {images[current]?.page}
                        {images.length > 1 && <span style={{ color: '#2e2e3a' }}> ({current + 1}/{images.length})</span>}
                    </span>
                    <button
                        onClick={onClose}
                        style={{ padding: 6, borderRadius: 6, background: '#17171b', border: '1px solid #252530', cursor: 'pointer', color: '#6e6e78', display: 'flex' }}
                        onMouseEnter={e => { e.currentTarget.style.color = '#e8e6e1'; e.currentTarget.style.borderColor = '#3a3a48'; }}
                        onMouseLeave={e => { e.currentTarget.style.color = '#6e6e78'; e.currentTarget.style.borderColor = '#252530'; }}
                    >
                        <X size={13} />
                    </button>
                </div>

                <div style={{
                    position: 'relative', borderRadius: 8, overflow: 'hidden',
                    background: '#0a0a0d', border: '1px solid #1a1a20',
                    maxHeight: '75vh', display: 'flex', alignItems: 'center', justifyContent: 'center',
                    minWidth: 200, minHeight: 150,
                }}>
                    {!loaded[current] && !errors[current] && (
                        <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                            <Loader2 size={22} style={{ color: '#3a3a48', animation: 'spin 1s linear infinite' }} />
                        </div>
                    )}
                    {errors[current] ? (
                        <div style={{ padding: '24px 32px', color: '#3e3e48', fontSize: 12, textAlign: 'center', letterSpacing: '0.02em' }}>
                            <Image size={22} style={{ display: 'block', margin: '0 auto 8px', opacity: 0.3 }} />
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
                            padding: '6px 14px', borderRadius: 5, background: '#13131a',
                            border: '1px solid #252530', color: current === 0 ? '#2a2a30' : '#6e6e78',
                            cursor: current === 0 ? 'not-allowed' : 'pointer',
                            display: 'flex', alignItems: 'center', gap: 5, fontSize: 11,
                            fontFamily: "'DM Mono', monospace", transition: 'all 0.15s', letterSpacing: '0.03em',
                        }}>
                            <ChevronLeft size={12} /> Prev
                        </button>
                        <div style={{ display: 'flex', gap: 4 }}>
                            {images.map((img, i) => (
                                <button
                                    key={img.page}
                                    onClick={() => setCurrent(i)}
                                    style={{
                                        width: 26, height: 26, borderRadius: 5,
                                        background: i === current ? '#c8a96e' : '#13131a',
                                        border: `1px solid ${i === current ? '#c8a96e' : '#252530'}`,
                                        color: i === current ? '#0a0a0e' : '#4e4e58',
                                        fontSize: 10, fontWeight: 500, cursor: 'pointer',
                                        fontFamily: "'DM Mono', monospace", transition: 'all 0.15s',
                                    }}
                                >
                                    {img.page}
                                </button>
                            ))}
                        </div>
                        <button onClick={next} disabled={current === images.length - 1} style={{
                            padding: '6px 14px', borderRadius: 5, background: '#13131a',
                            border: '1px solid #252530',
                            color: current === images.length - 1 ? '#2a2a30' : '#6e6e78',
                            cursor: current === images.length - 1 ? 'not-allowed' : 'pointer',
                            display: 'flex', alignItems: 'center', gap: 5, fontSize: 11,
                            fontFamily: "'DM Mono', monospace", transition: 'all 0.15s', letterSpacing: '0.03em',
                        }}>
                            Next <ChevronRight size={12} />
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
            borderTop: '1px solid #1a1a20',
        }}>
            {images.map((img, i) => (
                <button
                    key={img.page}
                    onClick={() => onOpenViewer(images, i)}
                    style={{
                        position: 'relative',
                        width: 68, height: 68, borderRadius: 7, overflow: 'hidden',
                        background: '#0a0a0d', border: '1px solid #1a1a20',
                        cursor: 'pointer', padding: 0,
                        transition: 'all 0.2s', flexShrink: 0,
                    }}
                    onMouseEnter={e => { e.currentTarget.style.borderColor = '#c8a96e'; e.currentTarget.style.transform = 'scale(1.05)'; }}
                    onMouseLeave={e => { e.currentTarget.style.borderColor = '#1a1a20'; e.currentTarget.style.transform = 'scale(1)'; }}
                    title={`Page ${img.page}`}
                >
                    <PageThumb src={`${API}${img.url}`} />
                    <span style={{
                        position: 'absolute', bottom: 3, right: 4,
                        fontSize: 9, fontWeight: 500, color: '#e8e6e1',
                        background: 'rgba(0,0,0,0.8)', borderRadius: 3,
                        padding: '1px 4px', lineHeight: 1.4,
                        fontFamily: "'DM Mono', monospace",
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
                <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#0a0a0d' }}>
                    <Loader2 size={13} style={{ color: '#2a2a30', animation: 'spin 1s linear infinite' }} />
                </div>
            )}
            {error ? (
                <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#0a0a0d' }}>
                    <Image size={13} style={{ color: '#2a2a30', opacity: 0.5 }} />
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
                width: open ? 168 : 0,
                overflow: 'hidden',
                background: '#0a0a0d',
                borderLeft: open ? '1px solid #1a1a20' : 'none',
                transition: 'width 0.25s cubic-bezier(0.4,0,0.2,1)',
                zIndex: 40, flexShrink: 0,
                display: 'flex', flexDirection: 'column',
                fontFamily: "'DM Mono', monospace",
            }}>
                <div style={{
                    padding: '11px 12px 8px',
                    borderBottom: '1px solid #1a1a20',
                    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                    flexShrink: 0,
                }}>
                    <span style={{ fontSize: 10, color: '#3e3e48', fontWeight: 400, letterSpacing: '0.08em', textTransform: 'uppercase' }}>
                        Pages
                    </span>
                    <button onClick={onClose} style={{ padding: 4, borderRadius: 4, background: 'transparent', border: 'none', cursor: 'pointer', color: '#3e3e48', display: 'flex' }}
                        onMouseEnter={e => e.currentTarget.style.color = '#6e6e78'}
                        onMouseLeave={e => e.currentTarget.style.color = '#3e3e48'}>
                        <X size={11} />
                    </button>
                </div>
                <div style={{ flex: 1, overflowY: 'auto', padding: '10px', display: 'flex', flexDirection: 'column', gap: 7 }}>
                    {loading && (
                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '20px 0' }}>
                            <Loader2 size={16} style={{ color: '#3e3e48', animation: 'spin 1s linear infinite' }} />
                        </div>
                    )}
                    {!loading && pages.length === 0 && (
                        <p style={{ fontSize: 11, color: '#2e2e38', textAlign: 'center', padding: '20px 0', letterSpacing: '0.02em' }}>No page images</p>
                    )}
                    {pages.map((pg, i) => (
                        <button
                            key={pg.page}
                            onClick={() => { setViewerImages(pages); }}
                            style={{
                                position: 'relative', width: '100%', paddingBottom: '133%',
                                borderRadius: 6, overflow: 'hidden',
                                background: '#13131a', border: '1px solid #1e1e22',
                                cursor: 'pointer', padding: 0, flexShrink: 0,
                                transition: 'border-color 0.15s',
                            }}
                            onMouseEnter={e => e.currentTarget.style.borderColor = '#c8a96e'}
                            onMouseLeave={e => e.currentTarget.style.borderColor = '#1e1e22'}
                        >
                            <div style={{ position: 'absolute', inset: 0 }}>
                                <PageThumb src={`${API}${pg.url}`} />
                            </div>
                            <span style={{
                                position: 'absolute', bottom: 4, left: '50%', transform: 'translateX(-50%)',
                                fontSize: 9, fontWeight: 500, color: '#e8e6e1',
                                background: 'rgba(0,0,0,0.8)', borderRadius: 3,
                                padding: '1px 6px', whiteSpace: 'nowrap',
                                fontFamily: "'DM Mono', monospace",
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
   Markdown renderer — editorial terminal style
───────────────────────────────────────── */
const MarkdownMessage = ({ content }) => (
    <ReactMarkdown
        remarkPlugins={[remarkGfm, remarkMath]}
        rehypePlugins={[rehypeRaw, [rehypeKatex, { strict: false, throwOnError: false }]]}
        components={{
            div: ({ className, children, ...props }) => {
                if (className?.includes('math-display')) return (
                    <div style={{ margin: '14px 0', padding: '14px 18px', background: '#0a0a0d', border: '1px solid #1e1e28', borderRadius: 6, overflowX: 'auto', textAlign: 'center' }} {...props}>{children}</div>
                );
                return <div className={className} {...props}>{children}</div>;
            },
            span: ({ className, children, ...props }) => {
                if (className?.includes('math-inline')) return (
                    <span style={{ padding: '2px 6px', borderRadius: 4, background: 'rgba(200,169,110,0.1)', color: '#c8a96e', fontFamily: "'DM Mono', monospace", fontSize: '0.875em' }} {...props}>{children}</span>
                );
                return <span className={className} {...props}>{children}</span>;
            },

            table: ({ ...props }) => (
                <div style={{
                    overflowX: 'auto', margin: '14px 0',
                    borderRadius: 6, border: '1px solid #1e1e22',
                    width: '100%',
                }}>
                    <table style={{
                        borderCollapse: 'collapse', fontSize: 12.5,
                        width: '100%', tableLayout: 'fixed',
                        whiteSpace: 'normal', wordBreak: 'break-word',
                        fontFamily: "'DM Mono', monospace",
                    }} {...props} />
                </div>
            ),
            thead: ({ ...props }) => <thead style={{ background: '#13131a' }} {...props} />,
            th: ({ ...props }) => (
                <th style={{
                    border: 'none', borderBottom: '1px solid #1e1e22',
                    padding: '10px 14px', textAlign: 'left',
                    fontWeight: 400, color: '#6e6e78',
                    fontSize: 10, letterSpacing: '0.07em', textTransform: 'uppercase',
                    background: '#13131a', whiteSpace: 'normal', wordBreak: 'break-word',
                }} {...props} />
            ),
            td: ({ ...props }) => (
                <td style={{
                    border: 'none', borderBottom: '1px solid #141418',
                    padding: '9px 14px', color: '#8888a8',
                    fontSize: 12.5, lineHeight: 1.6, background: 'transparent',
                    whiteSpace: 'normal', wordBreak: 'break-word', verticalAlign: 'top',
                }} {...props} />
            ),
            tr: ({ ...props }) => (
                <tr
                    style={{ transition: 'background 0.12s' }}
                    onMouseEnter={e => e.currentTarget.style.background = 'rgba(200,169,110,0.03)'}
                    onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
                    {...props}
                />
            ),
            tbody: ({ ...props }) => <tbody {...props} />,

            code: ({ inline, children, ...props }) => inline
                ? <code style={{ background: 'rgba(200,169,110,0.08)', padding: '2px 7px', borderRadius: 4, color: '#c8a96e', fontSize: '0.84em', fontFamily: "'DM Mono', monospace" }} {...props}>{children}</code>
                : <pre style={{ background: '#0a0a0d', border: '1px solid #1a1a20', borderRadius: 6, padding: '14px 16px', overflowX: 'auto', margin: '12px 0' }}>
                    <code style={{ color: '#8888a8', fontSize: '0.8em', fontFamily: "'DM Mono', monospace", lineHeight: 1.75 }} {...props}>{children}</code>
                </pre>,

            h1: ({ ...props }) => <h1 style={{ fontSize: 17, fontWeight: 300, color: '#e8e6e1', margin: '18px 0 6px', fontFamily: "'Fraunces', serif", fontStyle: 'italic' }} {...props} />,
            h2: ({ ...props }) => <h2 style={{ fontSize: 14, fontWeight: 300, color: '#c8c6c1', margin: '14px 0 5px', fontFamily: "'Fraunces', serif", fontStyle: 'italic' }} {...props} />,
            h3: ({ ...props }) => <h3 style={{ fontSize: 12.5, fontWeight: 400, color: '#a0a0b0', margin: '12px 0 4px', fontFamily: "'DM Mono', monospace", letterSpacing: '0.05em', textTransform: 'uppercase' }} {...props} />,
            ul: ({ ...props }) => <ul style={{ paddingLeft: 18, margin: '8px 0', display: 'flex', flexDirection: 'column', gap: 4 }} {...props} />,
            ol: ({ ...props }) => <ol style={{ paddingLeft: 18, margin: '8px 0', display: 'flex', flexDirection: 'column', gap: 4 }} {...props} />,
            li: ({ ...props }) => <li style={{ color: '#7070888', lineHeight: 1.7, fontSize: 13 }} {...props} />,
            p: ({ ...props }) => <p style={{ margin: '0 0 10px', color: '#8888a8', lineHeight: 1.75, fontSize: 13 }} {...props} />,
            strong: ({ ...props }) => <strong style={{ fontWeight: 500, color: '#c8c6c1' }} {...props} />,
            em: ({ ...props }) => <em style={{ fontStyle: 'italic', color: '#6e6e78', fontFamily: "'Fraunces', serif" }} {...props} />,
            blockquote: ({ ...props }) => <blockquote style={{ borderLeft: '2px solid #c8a96e', paddingLeft: 14, margin: '12px 0', color: '#6e6e78', fontStyle: 'italic', background: 'rgba(200,169,110,0.04)', borderRadius: '0 6px 6px 0', padding: '10px 14px' }} {...props} />,
            a: ({ ...props }) => <a style={{ color: '#c8a96e', textDecoration: 'underline', textUnderlineOffset: 3 }} target="_blank" rel="noopener noreferrer" {...props} />,
            hr: ({ ...props }) => <hr style={{ border: 'none', borderTop: '1px solid #1a1a20', margin: '16px 0' }} {...props} />,
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
            <button
                onClick={() => setOpen(o => !o)}
                style={{
                    display: 'flex', alignItems: 'center', gap: 6,
                    background: 'transparent', border: 'none',
                    cursor: 'pointer', padding: '3px 0',
                    color: done ? '#6e6e78' : '#8a7040',
                    fontSize: 11, fontFamily: "'DM Mono', monospace",
                    letterSpacing: '0.03em',
                }}
            >
                {!done
                    ? <Loader2 size={11} style={{ animation: 'spin 1s linear infinite', color: '#c8a96e' }} />
                    : <span style={{ fontSize: 10 }}>{open ? '▲' : '▼'}</span>
                }
                {done ? `Thought for ${secs}s` : 'Thinking…'}
            </button>
            {open && done && (
                <div style={{
                    marginTop: 6, padding: '10px 14px',
                    background: '#0a0a0d', border: '1px solid #1e1e22',
                    borderRadius: 6, fontSize: 11.5, color: '#4e4e58',
                    fontFamily: "'DM Mono', monospace", lineHeight: 1.7,
                    whiteSpace: 'pre-wrap',
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
                width: 5, height: 5, borderRadius: '50%',
                background: '#3a3a48',
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
        className="cb-file-option"
        onClick={onSelect}
        style={{
            width: '100%', textAlign: 'left',
            padding: '8px 14px', fontSize: 12,
            display: 'flex', alignItems: 'center', gap: 8,
            background: selected ? 'rgba(200,169,110,0.08)' : 'transparent',
            color: selected ? '#c8a96e' : '#6e6e78',
            border: 'none', cursor: 'pointer',
            fontFamily: "'DM Mono', monospace",
            letterSpacing: '0.01em',
            transition: 'background 0.1s, color 0.1s',
        }}
    >
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
    const prompts = [
        'Summarize this document',
        'What are the key findings?',
        'List all tables and figures',
        'What are the main conclusions?',
    ];
    return (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, justifyContent: 'center', maxWidth: 500 }}>
            {prompts.map(p => (
                <button
                    key={p}
                    onClick={() => onSelect(p)}
                    style={{
                        padding: '7px 14px', borderRadius: 4,
                        background: 'rgba(200,169,110,0.05)',
                        border: '1px solid rgba(200,169,110,0.15)',
                        color: '#c8a96e', fontSize: 11.5,
                        cursor: 'pointer', fontFamily: "'DM Mono', monospace",
                        letterSpacing: '0.03em',
                        transition: 'all 0.15s',
                    }}
                    onMouseEnter={e => { e.currentTarget.style.background = 'rgba(200,169,110,0.1)'; e.currentTarget.style.borderColor = 'rgba(200,169,110,0.3)'; }}
                    onMouseLeave={e => { e.currentTarget.style.background = 'rgba(200,169,110,0.05)'; e.currentTarget.style.borderColor = 'rgba(200,169,110,0.15)'; }}
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
        content: 'Upload a PDF or TXT and start querying.',
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
                content: `Re-indexing **"${filename}"** started.`,
                timestamp: new Date(), images: [],
            }]);
        } catch (err) {
            setMessages(prev => [...prev, {
                id: Date.now(), type: 'bot',
                content: `Re-index failed: ${err.response?.data?.error || err.message}`,
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
                content: `**"${uploaded}"** uploaded and indexed. You can now query it.`,
                timestamp: new Date(), images: [],
            }]);
        } catch (err) {
            setMessages(prev => [...prev, {
                id: Date.now(), type: 'bot',
                content: `Upload failed: ${err.response?.data?.error || err.message}`,
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
                content: 'Please upload or select a file first.',
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
        setMessages(prev => [...prev, { id: botId, type: 'bot', content: '', timestamp: new Date(), images: [], thinking: '', thinkDone: false }]);

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
                        if (json.think_token) {
                            setMessages(prev => prev.map(msg =>
                                msg.id === botId ? { ...msg, thinking: (msg.thinking || '') + json.think_token } : msg
                            ));
                            continue;
                        }
                        if (json.think_end) {
                            setMessages(prev => prev.map(msg =>
                                msg.id === botId ? { ...msg, thinkDone: true } : msg
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
                msg.id === botId ? { ...msg, content: `Error: ${error.message}` } : msg
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
            {/* Google Fonts — same as ReportPanel */}
            <link rel="preconnect" href="https://fonts.googleapis.com" />
            <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="" />
            <link href="https://fonts.googleapis.com/css2?family=Fraunces:ital,opsz,wght@0,9..144,300;0,9..144,500;1,9..144,300&family=DM+Mono:wght@300;400;500&display=swap" rel="stylesheet" />

            <style>{`
                * { box-sizing: border-box; margin: 0; padding: 0; }

                ::-webkit-scrollbar { width: 4px; height: 4px; }
                ::-webkit-scrollbar-track { background: transparent; }
                ::-webkit-scrollbar-thumb { background: #252530; border-radius: 99px; }
                ::-webkit-scrollbar-thumb:hover { background: #3a3a48; }

                @keyframes spin { to { transform: rotate(360deg); } }
                @keyframes bounce {
                    0%, 80%, 100% { transform: translateY(0); opacity: 0.3; }
                    40% { transform: translateY(-4px); opacity: 1; }
                }
                @keyframes shimmer {
                    0% { opacity: 0.4; } 50% { opacity: 1; } 100% { opacity: 0.4; }
                }
                @keyframes modalIn {
                    from { opacity: 0; transform: scale(0.96) translateY(8px); }
                    to   { opacity: 1; transform: scale(1) translateY(0); }
                }
                @keyframes fadeSlideUp {
                    from { opacity: 0; transform: translateY(10px); }
                    to   { opacity: 1; transform: translateY(0); }
                }
                @keyframes fadeIn {
                    from { opacity: 0; } to { opacity: 1; }
                }
                @keyframes scrollBtnIn {
                    from { opacity: 0; transform: translateX(-50%) translateY(8px); }
                    to   { opacity: 1; transform: translateX(-50%) translateY(0); }
                }
                @keyframes pulse {
                    0%, 100% { opacity: 1; } 50% { opacity: 0.3; }
                }

                .cb-msg-bot  { animation: fadeSlideUp 0.22s ease forwards; }
                .cb-msg-user { animation: fadeSlideUp 0.16s ease forwards; }

                .cb-send-btn:not(:disabled):hover { background: #d4b880 !important; }
                .cb-send-btn:not(:disabled):active { transform: scale(0.92); }

                .cb-input-area:focus-within {
                    border-color: rgba(200,169,110,0.4) !important;
                    box-shadow: 0 0 0 3px rgba(200,169,110,0.06) !important;
                }

                .cb-file-option:hover { background: rgba(200,169,110,0.06) !important; color: #a0a0b0 !important; }

                .cb-topbar-btn { transition: all 0.15s; }
                .cb-topbar-btn:hover { background: #17171b !important; border-color: #2a2a30 !important; color: #c8c6c1 !important; }
                .cb-topbar-btn.active { background: #1e1a0f !important; border-color: rgba(200,169,110,0.3) !important; color: #c8a96e !important; }

                .cb-file-chip:hover { background: rgba(200,169,110,0.1) !important; border-color: rgba(200,169,110,0.3) !important; }
            `}</style>

            <div style={{
                position: 'relative', display: 'flex', flexDirection: 'column',
                height: '100vh',
                background: '#0e0e10',
                fontFamily: "'DM Mono', 'Fira Code', monospace",
                color: '#e8e6e1', overflow: 'hidden',
                letterSpacing: '0.01em',
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
                    borderBottom: '1px solid #1e1e22',
                    padding: '0 20px',
                    height: 52,
                    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                    flexShrink: 0,
                    background: 'rgba(14,14,16,0.98)',
                    backdropFilter: 'blur(14px)',
                    position: 'sticky', top: 0, zIndex: 100,
                }}>
                    {/* Brand — mirrors ReportPanel topbar */}
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        <span style={{ color: '#c8a96e', fontSize: 17, lineHeight: 1 }}>◈</span>
                        <div>
                            <p style={{ fontSize: 14, fontWeight: 500, color: '#e8e6e1', lineHeight: 1, letterSpacing: '0.02em', fontFamily: "'Fraunces', serif" }}>
                                CMTI Bot
                            </p>

                        </div>
                    </div>

                    {/* Right controls */}
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>

                        {/* New Chat */}
                        <button
                            className="cb-topbar-btn"
                            onClick={() => {
                                setMessages([{ id: 1, type: 'bot', content: 'Upload a PDF or TXT and start querying.', timestamp: new Date(), images: [] }]);
                                setInputValue('');
                                setUserScrolled(false);
                            }}
                            style={{
                                display: 'flex', alignItems: 'center', gap: 5,
                                background: 'transparent', border: '1px solid #252530',
                                color: '#4e4e58', padding: '5px 11px', borderRadius: 4,
                                fontSize: 11.5, cursor: 'pointer',
                                fontFamily: "'DM Mono', monospace", letterSpacing: '0.03em',
                            }}
                        >
                            <Plus size={11} />
                            <span style={{ display: window.innerWidth < 480 ? 'none' : 'inline' }}>New chat</span>
                        </button>

                        {selectedFile && (
                            <button
                                className={`cb-topbar-btn${showReport ? ' active' : ''}`}
                                onClick={() => setShowReport(s => !s)}
                                style={{
                                    display: 'flex', alignItems: 'center', gap: 5,
                                    background: 'transparent', border: '1px solid #252530',
                                    color: '#4e4e58', padding: '5px 11px', borderRadius: 4,
                                    fontSize: 11.5, cursor: 'pointer',
                                    fontFamily: "'DM Mono', monospace", letterSpacing: '0.03em',
                                }}
                            >
                                <FileText size={11} />
                                <span style={{ display: window.innerWidth < 480 ? 'none' : 'inline' }}>Report</span>
                            </button>
                        )}

                        {selectedFile && (
                            <button
                                className={`cb-topbar-btn${showSidebar ? ' active' : ''}`}
                                onClick={() => setShowSidebar(s => !s)}
                                style={{
                                    display: 'flex', alignItems: 'center', gap: 5,
                                    background: 'transparent', border: '1px solid #252530',
                                    color: '#4e4e58', padding: '5px 11px', borderRadius: 4,
                                    fontSize: 11.5, cursor: 'pointer',
                                    fontFamily: "'DM Mono', monospace", letterSpacing: '0.03em',
                                }}
                            >
                                <LayoutGrid size={11} />
                                <span style={{ display: window.innerWidth < 480 ? 'none' : 'inline' }}>Pages</span>
                            </button>
                        )}

                        <button
                            className="cb-topbar-btn"
                            onClick={() => setShowUploadPanel(true)}
                            disabled={uploading}
                            style={{
                                display: 'flex', alignItems: 'center', gap: 5,
                                background: 'transparent', border: '1px solid #252530',
                                color: uploading ? '#3e3e48' : '#c8a96e',
                                padding: '5px 11px', borderRadius: 4,
                                fontSize: 11.5, cursor: uploading ? 'wait' : 'pointer',
                                opacity: uploading ? 0.65 : 1,
                                fontFamily: "'DM Mono', monospace", letterSpacing: '0.03em',
                            }}
                        >
                            {uploading
                                ? <Loader2 size={11} style={{ animation: 'spin 1s linear infinite' }} />
                                : <Upload size={11} />
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
                                    background: showDropdown ? '#17171b' : 'transparent',
                                    border: `1px solid ${showDropdown ? 'rgba(200,169,110,0.25)' : '#252530'}`,
                                    color: '#a0a0b0', padding: '5px 11px', borderRadius: 4,
                                    fontSize: 11.5, cursor: 'pointer',
                                    fontFamily: "'DM Mono', monospace", letterSpacing: '0.01em',
                                    maxWidth: 200,
                                }}
                            >
                                <span style={{ width: 5, height: 5, borderRadius: '50%', background: '#c8a96e', flexShrink: 0 }} />
                                <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1, maxWidth: 130 }}>
                                    {selectedFile || 'No file'}
                                </span>
                                {files.find(f => f.name === selectedFile)?.status === 'indexing' && (
                                    <Clock size={9} style={{ color: '#8a7040', flexShrink: 0 }} />
                                )}
                                <ChevronDown size={10} style={{ color: '#3e3e48', flexShrink: 0, transform: showDropdown ? 'rotate(180deg)' : 'rotate(0)', transition: 'transform 0.2s' }} />
                            </button>

                            {showDropdown && (
                                <div style={{
                                    position: 'absolute', right: 0, top: 'calc(100% + 6px)',
                                    width: 260, background: '#0e0e10',
                                    border: '1px solid #1e1e22', borderRadius: 6,
                                    boxShadow: '0 20px 60px rgba(0,0,0,0.7)',
                                    zIndex: 2, overflow: 'hidden',
                                    animation: 'fadeIn 0.14s ease',
                                }}>
                                    {files.length === 0
                                        ? <p style={{ color: '#3e3e48', fontSize: 12, padding: '12px 16px', letterSpacing: '0.03em' }}>No files indexed yet</p>
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
                    {(isEmpty || hasFileButEmpty) && (
                        <div style={{
                            flex: 1, display: 'flex', flexDirection: 'column',
                            alignItems: 'center', justifyContent: 'center',
                            gap: 20, padding: '0 24px',
                            animation: 'fadeSlideUp 0.35s ease',
                        }}>
                            {/* Decorative symbol */}
                            <div style={{ fontSize: 32, color: '#2a2a35', lineHeight: 1 }}>∴</div>
                            <div style={{ textAlign: 'center' }}>
                                <p style={{ fontSize: 16, fontWeight: 300, color: '#4a4a56', fontFamily: "'Fraunces', serif", fontStyle: 'italic' }}>
                                    {isEmpty ? 'No documents loaded' : `Query · ${selectedFile}`}
                                </p>
                                <p style={{ fontSize: 11.5, color: '#2e2e3a', marginTop: 6, letterSpacing: '0.03em' }}>
                                    {isEmpty ? 'Upload a PDF or TXT to begin' : 'Type a question or select a prompt below'}
                                </p>
                            </div>
                            {isEmpty ? (
                                <button
                                    onClick={() => setShowUploadPanel(true)}
                                    style={{
                                        display: 'flex', alignItems: 'center', gap: 8,
                                        background: '#c8a96e', color: '#0a0a0e',
                                        padding: '9px 20px', borderRadius: 4,
                                        fontSize: 12, fontWeight: 500,
                                        border: 'none', cursor: 'pointer',
                                        fontFamily: "'DM Mono', monospace",
                                        letterSpacing: '0.04em',
                                        transition: 'background 0.15s',
                                    }}
                                    onMouseEnter={e => e.currentTarget.style.background = '#d4b880'}
                                    onMouseLeave={e => e.currentTarget.style.background = '#c8a96e'}
                                >
                                    <Upload size={13} />
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
                                padding: '28px 24px 20px',
                                display: 'flex', flexDirection: 'column',
                            }}
                        >
                            <div style={{ maxWidth: 760, width: '100%', margin: '0 auto', display: 'flex', flexDirection: 'column', gap: 22 }}>
                                {messages.map((msg, idx) => (
                                    <div
                                        key={msg.id}
                                        className={msg.type === 'user' ? 'cb-msg-user' : 'cb-msg-bot'}
                                        style={{
                                            display: 'flex',
                                            justifyContent: msg.type === 'user' ? 'flex-end' : 'flex-start',
                                            animationDelay: `${Math.min(idx * 0.03, 0.18)}s`,
                                            animationFillMode: 'both',
                                        }}
                                    >
                                        {msg.type === 'user' ? (
                                            /* User bubble */
                                            <div style={{
                                                maxWidth: '72%',
                                                background: '#17171b',
                                                border: '1px solid rgba(200,169,110,0.2)',
                                                color: '#c8c6c1',
                                                padding: '10px 15px',
                                                borderRadius: '8px 8px 2px 8px',
                                                fontSize: 13, lineHeight: 1.65,
                                                fontFamily: "'DM Mono', monospace",
                                                letterSpacing: '0.01em',
                                            }}>
                                                {msg.content}
                                            </div>
                                        ) : (
                                            /* Bot message */
                                            <div style={{ display: 'flex', gap: 12, maxWidth: '100%', alignItems: 'flex-start', width: '100%' }}>
                                                {/* Avatar */}
                                                <div style={{
                                                    width: 26, height: 26, borderRadius: 6, flexShrink: 0,
                                                    background: '#17171b',
                                                    border: '1px solid rgba(200,169,110,0.2)',
                                                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                                                    marginTop: 2,
                                                }}>
                                                    <span style={{ color: '#c8a96e', fontSize: 12, lineHeight: 1 }}>◈</span>
                                                </div>
                                                <div style={{ flex: 1, minWidth: 0, overflowX: 'hidden', paddingTop: 2 }}>
                                                    {msg.thinking && (
                                                        <ThinkBlock thinking={msg.thinking} done={msg.thinkDone} />
                                                    )}
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
                            position: 'absolute', right: showSidebar ? 168 : 0, top: 0, bottom: 0,
                            width: 460, overflowY: 'auto',
                            background: '#0e0e10',
                            borderLeft: '1px solid #1e1e22',
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
                            display: 'flex', alignItems: 'center', gap: 5,
                            background: '#13131a',
                            border: '1px solid #252530',
                            color: '#6e6e78',
                            padding: '6px 14px', borderRadius: 4,
                            fontSize: 11.5,
                            cursor: 'pointer', fontFamily: "'DM Mono', monospace",
                            letterSpacing: '0.03em',
                            boxShadow: '0 4px 24px rgba(0,0,0,0.6)',
                            animation: 'scrollBtnIn 0.2s cubic-bezier(0.34,1.56,0.64,1)',
                            transition: 'all 0.15s',
                            whiteSpace: 'nowrap',
                        }}
                        onMouseEnter={e => { e.currentTarget.style.color = '#c8c6c1'; e.currentTarget.style.borderColor = '#3a3a48'; }}
                        onMouseLeave={e => { e.currentTarget.style.color = '#6e6e78'; e.currentTarget.style.borderColor = '#252530'; }}
                    >
                        <ArrowDown size={11} />
                        Scroll to bottom
                    </button>
                )}

                {/* ── Input Bar ── */}
                <div style={{
                    borderTop: '1px solid #1e1e22',
                    padding: '10px 20px 16px',
                    flexShrink: 0,
                    background: 'rgba(14,14,16,0.98)',
                    backdropFilter: 'blur(14px)',
                }}>
                    {/* Active file chip */}
                    {selectedFile && (
                        <div style={{ maxWidth: 760, margin: '0 auto 8px' }}>
                            <span
                                className="cb-file-chip"
                                style={{
                                    display: 'inline-flex', alignItems: 'center', gap: 6,
                                    background: 'rgba(200,169,110,0.06)',
                                    border: '1px solid rgba(200,169,110,0.15)',
                                    color: '#c8a96e', fontSize: 10.5,
                                    padding: '4px 10px', borderRadius: 4,
                                    cursor: 'pointer', transition: 'all 0.15s',
                                    fontFamily: "'DM Mono', monospace", letterSpacing: '0.04em',
                                }}
                                onClick={() => setShowUploadPanel(true)}
                            >
                                <span style={{ width: 4, height: 4, borderRadius: '50%', background: '#c8a96e', flexShrink: 0 }} />
                                {selectedFile}
                                {files.find(f => f.name === selectedFile)?.status === 'indexing' && (
                                    <span style={{ display: 'flex', alignItems: 'center', gap: 3, color: '#8a7040' }}>
                                        <Clock size={8} /> indexing…
                                    </span>
                                )}
                            </span>
                        </div>
                    )}

                    {/* Textarea + buttons */}
                    <div style={{ maxWidth: 760, margin: '0 auto' }}>
                        <div
                            className="cb-input-area"
                            style={{
                                display: 'flex', alignItems: 'flex-end', gap: 8,
                                background: '#13131a', border: '1px solid #252530',
                                borderRadius: 6, padding: '8px 8px 8px 13px',
                                transition: 'border-color 0.2s, box-shadow 0.2s',
                            }}
                        >
                            <button
                                onClick={() => setShowUploadPanel(true)}
                                disabled={uploading}
                                style={{
                                    padding: 7, borderRadius: 5, background: 'transparent',
                                    border: 'none', cursor: uploading ? 'wait' : 'pointer',
                                    color: '#3e3e48', flexShrink: 0, opacity: uploading ? 0.5 : 1,
                                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                                    transition: 'all 0.15s', marginBottom: 1,
                                }}
                                onMouseEnter={e => { if (!uploading) { e.currentTarget.style.color = '#c8a96e'; } }}
                                onMouseLeave={e => { e.currentTarget.style.color = '#3e3e48'; }}
                            >
                                {uploading
                                    ? <Loader2 size={15} style={{ color: '#c8a96e', animation: 'spin 1s linear infinite' }} />
                                    : <Paperclip size={15} />
                                }
                            </button>

                            <textarea
                                ref={textareaRef}
                                value={inputValue}
                                onChange={e => setInputValue(e.target.value)}
                                onKeyDown={handleKeyDown}
                                placeholder={!selectedFile ? 'Upload a file to start…' : `Query ${selectedFile}…`}
                                rows={1}
                                style={{
                                    flex: 1, background: 'transparent', border: 'none',
                                    outline: 'none', resize: 'none', color: '#c8c6c1',
                                    fontSize: 13, lineHeight: 1.6,
                                    fontFamily: "'DM Mono', monospace",
                                    letterSpacing: '0.01em',
                                    padding: '5px 0', maxHeight: 160, overflowY: 'auto',
                                }}
                            />

                            <button
                                className="cb-send-btn"
                                onClick={() => handleSend()}
                                disabled={!inputValue.trim() || !selectedFile || uploading}
                                style={{
                                    width: 32, height: 32, borderRadius: 5, flexShrink: 0,
                                    background: inputValue.trim() && selectedFile && !uploading ? '#c8a96e' : '#17171b',
                                    border: `1px solid ${inputValue.trim() && selectedFile && !uploading ? '#c8a96e' : '#252530'}`,
                                    cursor: inputValue.trim() && selectedFile && !uploading ? 'pointer' : 'not-allowed',
                                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                                    color: inputValue.trim() && selectedFile && !uploading ? '#0a0a0e' : '#2e2e3a',
                                    transition: 'all 0.15s',
                                    marginBottom: 1,
                                }}
                            >
                                <Send size={13} />
                            </button>
                        </div>

                        <p style={{ fontSize: 10.5, color: '#2a2a38', textAlign: 'center', marginTop: 7, letterSpacing: '0.04em', textTransform: 'uppercase' }}>
                            Answers grounded in selected document only
                        </p>
                    </div>
                </div>
            </div>
        </>
    );
};

export default Chatbot;