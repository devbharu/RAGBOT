import React, { useState, useRef, useEffect, useCallback } from 'react';
import {
    Send, Paperclip, FileText, ChevronDown,
    Upload, X, FileUp, CheckCircle, Loader2
} from 'lucide-react';
import axios from 'axios';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';
import rehypeKatex from 'rehype-katex';
import 'katex/dist/katex.min.css';

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
            className={`
                relative flex flex-col items-center justify-center gap-3
                border-2 border-dashed rounded-2xl p-10 cursor-pointer
                transition-all duration-200
                ${dragging ? 'border-blue-500 bg-blue-500/10 scale-[1.01]'
                    : 'border-[#3a3a3a] hover:border-[#555] bg-[#1e1e1e] hover:bg-[#252525]'}
                ${uploading ? 'opacity-80 cursor-wait pointer-events-none' : ''}
            `}
        >
            <input
                ref={inputRef} type="file" accept=".pdf,.txt"
                onChange={(e) => { const f = e.target.files[0]; if (f) onUpload(f); e.target.value = ''; }}
                className="hidden"
            />

            <div className={`w-14 h-14 rounded-2xl flex items-center justify-center transition-colors
                ${dragging ? 'bg-blue-500/20' : 'bg-[#2f2f2f]'}`}>
                {uploading
                    ? <Loader2 size={26} className="text-blue-400 animate-spin" />
                    : <FileUp size={26} className={dragging ? 'text-blue-400' : 'text-gray-400'} />
                }
            </div>

            <div className="text-center">
                <p className="text-sm font-medium text-gray-200">
                    {uploading ? uploadProgress : dragging ? 'Drop it!' : 'Drop your file here'}
                </p>
                <p className="text-xs text-gray-500 mt-1">
                    {uploading ? 'This may take a moment for large PDFs…' : 'or click to browse · PDF & TXT'}
                </p>
            </div>

            {/* Progress bar */}
            {uploading && (
                <div className="w-full bg-[#2f2f2f] rounded-full h-1 overflow-hidden">
                    <div className="h-full bg-blue-500 rounded-full animate-pulse w-full" />
                </div>
            )}
        </div>
    );
};

/* ─────────────────────────────────────────
   Upload Panel / Modal
───────────────────────────────────────── */
const UploadPanel = ({ onUpload, uploading, uploadProgress, onClose, files, selectedFile, onSelectFile }) => (
    <div
        className="absolute inset-0 z-40 flex items-center justify-center bg-black/60 backdrop-blur-sm"
        onClick={() => !uploading && onClose()}   // block close while uploading
    >
        <div
            className="relative w-full max-w-md mx-4 bg-[#1e1e1e] border border-[#2f2f2f] rounded-3xl shadow-2xl p-6 flex flex-col gap-5"
            onClick={e => e.stopPropagation()}
        >
            {/* Header */}
            <div className="flex items-center justify-between">
                <div>
                    <h2 className="text-base font-semibold text-white">Upload Document</h2>
                    <p className="text-xs text-gray-500 mt-0.5">PDF or TXT · indexed automatically</p>
                </div>
                {!uploading && (
                    <button onClick={onClose}
                        className="p-1.5 rounded-xl hover:bg-[#2f2f2f] text-gray-400 hover:text-white transition-colors">
                        <X size={16} />
                    </button>
                )}
            </div>

            {/* Drop Zone */}
            <UploadZone onUpload={onUpload} uploading={uploading} uploadProgress={uploadProgress} />

            {/* Indexed files list */}
            {!uploading && files.length > 0 && (
                <div>
                    <p className="text-xs text-gray-500 font-medium uppercase tracking-wider mb-2">Indexed files</p>
                    <div className="flex flex-col gap-1 max-h-48 overflow-y-auto">
                        {files.map(f => (
                            <button
                                key={f}
                                onClick={() => { onSelectFile(f); onClose(); }}
                                className={`flex items-center gap-2.5 w-full text-left px-3 py-2 rounded-xl text-sm transition-colors
                                    ${selectedFile === f
                                        ? 'bg-blue-600/20 text-blue-400 border border-blue-500/30'
                                        : 'hover:bg-[#2f2f2f] text-gray-300 border border-transparent'
                                    }`}
                            >
                                <FileText size={13} className={selectedFile === f ? 'text-blue-400' : 'text-gray-500'} />
                                <span className="truncate flex-1">{f}</span>
                                {selectedFile === f && <CheckCircle size={13} className="text-blue-400 flex-shrink-0" />}
                            </button>
                        ))}
                    </div>
                </div>
            )}
        </div>
    </div>
);

/* ─────────────────────────────────────────
   LaTeX delimiter normaliser
   \[...\]  →  $$...$$   (block)
   \(...\)  →  $...$     (inline)
───────────────────────────────────────── */
function normaliseMath(text) {
    text = text.replace(/\\\[([\s\S]*?)\\\]/g, (_, i) => `\n$$${i}$$\n`);
    text = text.replace(/\\\(([\s\S]*?)\\\)/g, (_, i) => `$${i}$`);
    return text;
}

/* ─────────────────────────────────────────
   Markdown + Math renderer
───────────────────────────────────────── */
const MarkdownMessage = ({ content }) => (
    <ReactMarkdown
        remarkPlugins={[remarkGfm, remarkMath]}
        rehypePlugins={[[rehypeKatex, { strict: false, throwOnError: false }]]}
        components={{
            div: ({ className, children, ...props }) => {
                if (className?.includes('math-display')) return (
                    <div className="my-3 rounded-xl border border-blue-500/30 bg-[#0d1117] px-5 py-4 overflow-x-auto text-center text-blue-100" {...props}>
                        {children}
                    </div>
                );
                return <div className={className} {...props}>{children}</div>;
            },
            span: ({ className, children, ...props }) => {
                if (className?.includes('math-inline')) return (
                    <span className="px-1 py-0.5 rounded bg-blue-900/30 text-blue-200 font-mono text-sm" {...props}>{children}</span>
                );
                return <span className={className} {...props}>{children}</span>;
            },
            table: ({ ...props }) => (
                <div className="overflow-x-auto my-2">
                    <table className="border-collapse text-sm w-full" {...props} />
                </div>
            ),
            thead: ({ ...props }) => <thead className="bg-[#3a3a3a]" {...props} />,
            th: ({ ...props }) => <th className="border border-[#555] px-3 py-2 text-left font-semibold text-white" {...props} />,
            td: ({ ...props }) => <td className="border border-[#555] px-3 py-2 text-gray-200" {...props} />,
            tr: ({ ...props }) => <tr className="even:bg-[#2a2a2a]" {...props} />,
            code: ({ inline, children, ...props }) => inline
                ? <code className="bg-[#3a3a3a] px-1.5 py-0.5 rounded text-blue-300 text-sm font-mono" {...props}>{children}</code>
                : <pre className="bg-[#1a1a1a] border border-[#3a3a3a] rounded-xl p-4 overflow-x-auto my-2">
                    <code className="text-green-300 text-sm font-mono">{children}</code>
                </pre>,
            h1: ({ ...props }) => <h1 className="text-xl font-bold text-white mt-3 mb-1" {...props} />,
            h2: ({ ...props }) => <h2 className="text-lg font-bold text-white mt-3 mb-1" {...props} />,
            h3: ({ ...props }) => <h3 className="text-base font-semibold text-white mt-2 mb-1" {...props} />,
            ul: ({ ...props }) => <ul className="list-disc list-inside space-y-1 my-2 text-gray-200" {...props} />,
            ol: ({ ...props }) => <ol className="list-decimal list-inside space-y-1 my-2 text-gray-200" {...props} />,
            li: ({ ...props }) => <li className="ml-2" {...props} />,
            p: ({ ...props }) => <p className="mb-2 last:mb-0 text-gray-100 leading-relaxed" {...props} />,
            strong: ({ ...props }) => <strong className="font-semibold text-white" {...props} />,
            em: ({ ...props }) => <em className="italic text-gray-300" {...props} />,
            blockquote: ({ ...props }) => <blockquote className="border-l-4 border-blue-500 pl-4 my-2 text-gray-400 italic" {...props} />,
        }}
    >
        {normaliseMath(content)}
    </ReactMarkdown>
);

/* ─────────────────────────────────────────
   Main Chatbot
───────────────────────────────────────── */
const Chatbot = () => {
    const [messages, setMessages] = useState([{
        id: 1, type: 'bot',
        content: 'Hello! Upload a PDF or TXT file and start asking questions.',
        timestamp: new Date()
    }]);
    const [inputValue, setInputValue] = useState('');
    const [isTyping, setIsTyping] = useState(false);
    const [files, setFiles] = useState([]);           // plain string[]
    const [selectedFile, setSelectedFile] = useState('');
    const [uploading, setUploading] = useState(false);
    const [uploadProgress, setUploadProgress] = useState('Uploading…');
    const [showDropdown, setShowDropdown] = useState(false);
    const [showUploadPanel, setShowUploadPanel] = useState(false);

    const messagesEndRef = useRef(null);
    const textareaRef = useRef(null);

    useEffect(() => { messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [messages]);

    useEffect(() => {
        if (textareaRef.current) {
            textareaRef.current.style.height = 'auto';
            textareaRef.current.style.height = `${textareaRef.current.scrollHeight}px`;
        }
    }, [inputValue]);

    useEffect(() => { fetchFiles(); }, []);

    const fetchFiles = async () => {
        try {
            const res = await axios.get(`${API}/files`);
            const raw = res.data.files || [];
            const list = raw.map(f => (typeof f === 'string' ? f : f.name));
            setFiles(list);
            if (list.length > 0 && !selectedFile) setSelectedFile(list[0]);
        } catch (e) { console.error('Failed to fetch files:', e); }
    };

    /* ── Upload: blocking — waits for backend to finish indexing ── */
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
            // Simulate progress label stages
            const progressTimer = setTimeout(() => setUploadProgress('Indexing document…'), 1500);

            const res = await axios.post(`${API}/upload`, formData, {
                headers: { 'Content-Type': 'multipart/form-data' }
                // no timeout — large PDFs take time
            });

            clearTimeout(progressTimer);

            const uploaded = res.data.file;
            await fetchFiles();
            setSelectedFile(uploaded);
            setShowUploadPanel(false);

            setMessages(prev => [...prev, {
                id: Date.now(), type: 'bot',
                content: `✅ **"${uploaded}"** uploaded and indexed! You can now ask questions about it.`,
                timestamp: new Date()
            }]);

        } catch (err) {
            setMessages(prev => [...prev, {
                id: Date.now(), type: 'bot',
                content: `⚠️ Upload failed: ${err.response?.data?.error || err.message}`,
                timestamp: new Date()
            }]);
        } finally {
            setUploading(false);
            setUploadProgress('Uploading…');
        }
    };

    /* ── Send message ── */
    const handleSend = async () => {
        if (!inputValue.trim()) return;

        if (!selectedFile) {
            setMessages(prev => [...prev, {
                id: Date.now(), type: 'bot',
                content: '⚠️ Please upload or select a file first.',
                timestamp: new Date()
            }]);
            return;
        }

        const userMsg = { id: Date.now(), type: 'user', content: inputValue, timestamp: new Date() };
        setMessages(prev => [...prev, userMsg]);
        setInputValue('');
        setIsTyping(true);

        const botId = Date.now() + 1;
        setMessages(prev => [...prev, { id: botId, type: 'bot', content: '', timestamp: new Date() }]);

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

            // Non-streaming fallback (small-talk / no-hits)
            if (contentType.includes('application/json')) {
                const data = await response.json();
                setMessages(prev => prev.map(msg =>
                    msg.id === botId ? { ...msg, content: data.response || '' } : msg
                ));
                return;
            }

            // Streaming with smooth drip
            const tokenQueue = [];
            const DRIP_INTERVAL = 18;
            const CHARS_PER_TICK = 2;

            const drip = setInterval(() => {
                if (tokenQueue.length === 0) return;
                const chunk = tokenQueue.splice(0, CHARS_PER_TICK).join('');
                setMessages(prev => prev.map(msg =>
                    msg.id === botId ? { ...msg, content: msg.content + chunk } : msg
                ));
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
                        const token = json.token || '';
                        if (token) tokenQueue.push(...token.split(''));
                    } catch { }
                }
            }

            // Drain remaining chars
            await new Promise(resolve => {
                const drain = setInterval(() => {
                    if (tokenQueue.length === 0) { clearInterval(drain); resolve(); return; }
                    const chunk = tokenQueue.splice(0, CHARS_PER_TICK).join('');
                    setMessages(prev => prev.map(msg =>
                        msg.id === botId ? { ...msg, content: msg.content + chunk } : msg
                    ));
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
        <div className="relative flex flex-col h-screen bg-[#212121] text-white overflow-hidden">

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
                />
            )}

            {/* ── Top Bar ── */}
            <div className="border-b border-[#2f2f2f] px-6 sm:px-10 py-3 flex items-center justify-between flex-shrink-0 bg-[#212121]">
                <div className="flex items-center gap-3">
                    <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-red-500 to-rose-600 flex items-center justify-center flex-shrink-0 shadow-lg shadow-red-900/30">
                        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                            <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
                        </svg>
                    </div>
                    <div>
                        <h1 className="text-sm font-semibold text-white leading-tight">CMTI Bot</h1>
                        <p className="text-[10px] text-gray-500 leading-tight">AI Assistant</p>
                    </div>
                </div>

                <div className="flex items-center gap-2">
                    {/* New Chat */}
                    <button
                        onClick={() => {
                            setMessages([{ id: 1, type: 'bot', content: 'Hello! Upload a PDF or TXT file and start asking questions.', timestamp: new Date() }]);
                            setInputValue('');
                        }}
                        className="flex items-center gap-1.5 bg-gradient-to-r from-red-500 to-rose-600 hover:from-red-600 hover:to-rose-700 text-white px-3 py-1.5 rounded-xl text-xs font-medium transition-all shadow-md shadow-red-900/20"
                    >
                        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                            <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
                        </svg>
                        <span>New Chat</span>
                    </button>

                    {/* Upload */}
                    <button
                        onClick={() => setShowUploadPanel(true)}
                        disabled={uploading}
                        className="flex items-center gap-1.5 bg-[#2f2f2f] hover:bg-[#3a3a3a] px-3 py-1.5 rounded-xl text-xs transition-colors text-gray-300 hover:text-white border border-[#3a3a3a] disabled:opacity-50"
                    >
                        {uploading
                            ? <Loader2 size={13} className="text-blue-400 animate-spin" />
                            : <Upload size={13} className="text-blue-400" />
                        }
                        <span className="hidden sm:inline">{uploading ? 'Indexing…' : 'Upload'}</span>
                    </button>

                    {/* File selector */}
                    <div className="relative">
                        <button
                            onClick={() => setShowDropdown(!showDropdown)}
                            className="flex items-center gap-2 bg-[#2f2f2f] hover:bg-[#3a3a3a] px-3 py-1.5 rounded-xl text-sm transition-colors"
                        >
                            <FileText size={14} className="text-blue-400 flex-shrink-0" />
                            <span className="max-w-[140px] sm:max-w-[180px] truncate text-gray-200">
                                {selectedFile || 'No file selected'}
                            </span>
                            <ChevronDown size={14} className="text-gray-400 flex-shrink-0" />
                        </button>

                        {showDropdown && (
                            <div className="absolute right-0 mt-1 w-72 bg-[#2f2f2f] border border-[#3a3a3a] rounded-xl shadow-xl z-50 overflow-hidden">
                                {files.length === 0
                                    ? <p className="text-gray-400 text-sm px-4 py-3">No files indexed yet</p>
                                    : files.map(f => (
                                        <button key={f}
                                            onClick={() => { setSelectedFile(f); setShowDropdown(false); }}
                                            className={`w-full text-left px-4 py-2.5 text-sm hover:bg-[#3a3a3a] transition-colors flex items-center gap-2
                                                ${selectedFile === f ? 'text-blue-400 bg-[#3a3a3a]' : 'text-gray-200'}`}>
                                            <FileText size={12} className="flex-shrink-0" />
                                            <span className="truncate flex-1">{f}</span>
                                            {selectedFile === f && <CheckCircle size={12} className="ml-auto flex-shrink-0 text-blue-400" />}
                                        </button>
                                    ))
                                }
                            </div>
                        )}
                    </div>
                </div>
            </div>

            {/* ── Empty state ── */}
            {files.length === 0 && messages.length <= 1 && (
                <div className="flex-1 flex flex-col items-center justify-center gap-6 px-4">
                    <div className="w-16 h-16 rounded-2xl bg-[#2f2f2f] flex items-center justify-center">
                        <FileUp size={28} className="text-gray-400" />
                    </div>
                    <div className="text-center">
                        <p className="text-base font-medium text-gray-200">No documents yet</p>
                        <p className="text-sm text-gray-500 mt-1">Upload a PDF or TXT to get started</p>
                    </div>
                    <button
                        onClick={() => setShowUploadPanel(true)}
                        className="flex items-center gap-2 bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium px-5 py-2.5 rounded-2xl transition-colors"
                    >
                        <Upload size={15} />
                        Upload a document
                    </button>
                </div>
            )}

            {/* ── Messages ── */}
            {(files.length > 0 || messages.length > 1) && (
                <div className="flex-1 overflow-y-auto px-4 sm:px-10 py-6 sm:py-8">
                    <div className="max-w-5xl mx-auto space-y-5 sm:space-y-7">
                        {messages.map(msg => (
                            <div key={msg.id} className={`flex ${msg.type === 'user' ? 'justify-end' : 'justify-start'}`}>
                                <div className={`flex gap-3 sm:gap-4 max-w-[95%] sm:max-w-[88%] ${msg.type === 'user' ? 'flex-row-reverse' : ''}`}>
                                    <div className={`w-7 h-7 sm:w-8 sm:h-8 rounded-full flex items-center justify-center text-xs sm:text-sm font-bold flex-shrink-0
                                        ${msg.type === 'user' ? 'bg-blue-600' : 'bg-green-600'}`}>
                                        {msg.type === 'user' ? 'U' : 'AI'}
                                    </div>
                                    <div className={`px-3 py-2 sm:px-4 sm:py-3 rounded-2xl text-sm sm:text-base leading-relaxed
                                        ${msg.type === 'user' ? 'bg-blue-600 text-white' : 'bg-[#2f2f2f]'}`}>
                                        {msg.type === 'bot'
                                            ? <MarkdownMessage content={msg.content} />
                                            : msg.content
                                        }
                                    </div>
                                </div>
                            </div>
                        ))}

                        {isTyping && (
                            <div className="flex justify-start">
                                <div className="flex gap-2 sm:gap-3">
                                    <div className="w-7 h-7 sm:w-8 sm:h-8 rounded-full bg-green-600 flex items-center justify-center text-xs font-bold">AI</div>
                                    <div className="bg-[#2f2f2f] px-4 py-3 rounded-2xl flex gap-1 items-center">
                                        <span className="w-2 h-2 bg-gray-400 rounded-full animate-bounce" style={{ animationDelay: '0ms' }} />
                                        <span className="w-2 h-2 bg-gray-400 rounded-full animate-bounce" style={{ animationDelay: '150ms' }} />
                                        <span className="w-2 h-2 bg-gray-400 rounded-full animate-bounce" style={{ animationDelay: '300ms' }} />
                                    </div>
                                </div>
                            </div>
                        )}
                        <div ref={messagesEndRef} />
                    </div>
                </div>
            )}

            {/* ── Input Bar ── */}
            <div className="border-t border-[#2f2f2f] px-4 sm:px-10 py-3 sm:py-4 flex-shrink-0">
                {selectedFile && (
                    <div className="max-w-5xl mx-auto mb-2">
                        <span className="inline-flex items-center gap-1.5 bg-[#2f2f2f] text-blue-400 text-xs px-3 py-1 rounded-full">
                            <FileText size={12} />
                            {selectedFile}
                        </span>
                    </div>
                )}

                <div className="max-w-5xl mx-auto flex items-center gap-2 bg-[#2f2f2f] rounded-3xl px-3 py-2">
                    <button
                        onClick={() => setShowUploadPanel(true)}
                        disabled={uploading}
                        className="p-1.5 sm:p-2 text-gray-400 hover:text-white transition-colors flex-shrink-0 disabled:opacity-40"
                        title="Upload file"
                    >
                        {uploading
                            ? <Loader2 size={16} className="text-blue-400 animate-spin" />
                            : <Paperclip size={16} />
                        }
                    </button>

                    <textarea
                        ref={textareaRef}
                        value={inputValue}
                        onChange={e => setInputValue(e.target.value)}
                        onKeyDown={handleKeyDown}
                        placeholder={!selectedFile ? 'Upload a file to start…' : `Ask about ${selectedFile}…`}
                        rows={1}
                        className="flex-1 bg-transparent resize-none outline-none text-sm sm:text-base text-white my-1 px-2 max-h-40"
                    />

                    <button
                        onClick={handleSend}
                        disabled={!inputValue.trim() || !selectedFile || uploading}
                        className={`p-1.5 sm:p-2 rounded-full transition-colors flex-shrink-0
                            ${inputValue.trim() && selectedFile && !uploading
                                ? 'bg-blue-600 hover:bg-blue-700'
                                : 'bg-gray-600 cursor-not-allowed opacity-50'}`}
                    >
                        <Send size={16} />
                    </button>
                </div>

                <p className="text-xs text-gray-500 text-center mt-2 max-w-5xl mx-auto">
                    Answers are based only on the selected document.
                </p>
            </div>
        </div>
    );
};

export default Chatbot;