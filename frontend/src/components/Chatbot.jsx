/**
 * Chatbot.jsx — CMTI Bot v9.1
 * Fix: handleGenerateMultiReport now persists selectedFiles before navigating
 */

import React, { useState, useRef, useEffect, useCallback } from "react";
import {
    Edit3, GraduationCap, Coffee, Sparkles, Code,
    Send, Paperclip, FileText, ChevronDown,
    Upload, X, FileUp, CheckCircle, Loader2,
    ArrowDown, ArrowUp, RefreshCw, Clock, FileSearch,
    Trash2, Sun, Moon, Share2, Copy, Check, Bot,
    Layers, ChevronRight, SquareStack, Search, Network, Globe, Settings, Database, Plus
} from "lucide-react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import rehypeKatex from "rehype-katex";
import rehypeRaw from "rehype-raw";
import "katex/dist/katex.min.css";
import { useNavigate } from "react-router-dom";
import { useFileStore, useChatStore, useReportStore, API } from "../context/AppContext";
import { useTheme } from "../context/ThemeContext";
import { useAuth } from "../context/AuthContext";
import { CopyButton, PasteModal, PasteChip, MarkdownMessage, ThinkBlock, TypingDots, SuggestedQuestions, ThemeToggle, formatBytes, isCodeLike, PASTE_CARD_THRESHOLD } from "./chatbot/ChatUtils";
import { UploadPanel } from "./chatbot/UploadPanel";
import { PdfViewerPanel } from "./chatbot/PdfViewerPanel";
import { StreamController } from "../lib/streaming/StreamController";
import { StepsSidebar } from "./chatbot/StepsSidebar";
import { ArtifactPanel } from "./chatbot/ArtifactPanel";



/* ─── Main Chatbot ───────────────────────────────────────────── */
const Chatbot = () => {
    const navigate = useNavigate();
    const { user, token } = useAuth();
    const {
        files, selectedFile, setSelectedFile, uploading,
        handleDeleteFile, selectedFiles, setSelectedFiles
    } = useFileStore();

    const {
        messages, setMessages,
        currentChatId, createChat, setChats
    } = useChatStore();

    const {
        setReportQuery, setReportTitle, setReportMode
    } = useReportStore();
    const [searchMode, setSearchMode] = useState("vector"); // 'vector' or 'tree'
    const [searchScope, setSearchScope] = useState("active"); // 'active' or 'all'


    const controllerRef = useRef(new StreamController(`${API}/generate`));
    const [uiState, setUiState] = useState(controllerRef.current.state);

    useEffect(() => {
        controllerRef.current.onChatRenamed = (data) => {
            setChats(prev => prev.map(c => String(c.id) === String(data.chat_id) ? { ...c, title: data.new_title } : c));
        };
        const unsubscribe = controllerRef.current.subscribe(setUiState);

        return () => unsubscribe();
    }, [setChats]);

    const [inputValue, setInputValue] = useState("");
    const [pasteCards, setPasteCards] = useState([]);
    const [modalCardId, setModalCardId] = useState(null);
    const [isTyping, setIsTyping] = useState(false);
    const [isStreaming, setIsStreaming] = useState(false);
    const [activePanel, setActivePanel] = useState(null);
    const [activeArtifact, setActiveArtifact] = useState(null);
    const [pdfPage, setPdfPage] = useState(null);
    const [showSelectionModal, setShowSelectionModal] = useState(false);
    const [showAnalyticsModal, setShowAnalyticsModal] = useState(false);
    const [showUploadPanel, setShowUploadPanel] = useState(false);

    const [isAtTop, setIsAtTop] = useState(true);
    const [isAtBottom, setIsAtBottom] = useState(true);

    const handleCitationClick = useCallback((page) => {
        setPdfPage(page);
        setActivePanel("pdf");
    }, []);

    const closeArtifact = useCallback(() => {
        setActiveArtifact(null);
    }, []);

    const scrollContainerRef = useRef(null);
    const textareaRef = useRef(null);
    const abortControllerRef = useRef(null);
    const activeRequestIdRef = useRef(0);
    const isAtBottomRef = useRef(true);
    const shouldAutoScrollRef = useRef(true);
    const SCROLL_THRESHOLD = 80;

    const scrollToBottom = useCallback((behavior = "smooth") => {
        const el = scrollContainerRef.current;
        if (!el) return;
        el.scrollTo({ top: el.scrollHeight, behavior });
    }, []);

    const scrollToTop = useCallback((behavior = "smooth") => {
        const el = scrollContainerRef.current;
        if (!el) return;
        el.scrollTo({ top: 0, behavior });
    }, []);

    const checkIsAtBottom = useCallback(() => {
        const el = scrollContainerRef.current;
        if (!el) return true;
        return el.scrollHeight - el.scrollTop <= el.clientHeight + SCROLL_THRESHOLD;
    }, []);

    const checkIsAtTop = useCallback(() => {
        const el = scrollContainerRef.current;
        if (!el) return true;
        return el.scrollTop <= 0;
    }, []);

    const handleScroll = useCallback(() => {
        const atTop = checkIsAtTop();
        const atBottom = checkIsAtBottom();
        isAtBottomRef.current = atBottom;
        shouldAutoScrollRef.current = atBottom;
        setIsAtTop(atTop);
        setIsAtBottom(atBottom);
    }, [checkIsAtBottom, checkIsAtTop]);

    useEffect(() => {
        if (shouldAutoScrollRef.current) scrollToBottom("auto");
        requestAnimationFrame(() => handleScroll());
    }, [messages, scrollToBottom, handleScroll]);

    useEffect(() => { if (isTyping && isAtBottomRef.current) scrollToBottom("auto"); }, [messages, isTyping, scrollToBottom]);

    useEffect(() => {
        if (textareaRef.current) {
            textareaRef.current.style.height = "auto";
            textareaRef.current.style.height = `${Math.min(textareaRef.current.scrollHeight, 200)}px`;
        }
    }, [inputValue]);

    const appendToLastAssistant = useCallback((updater) => {
        setMessages((prev) => {
            const next = [...prev];
            for (let i = next.length - 1; i >= 0; i--) {
                if (next[i].type === "bot") { next[i] = updater(next[i]); break; }
            }
            return next;
        });
    }, [setMessages]);

    const isRequestActive = useCallback((requestId) =>
        activeRequestIdRef.current === requestId && !abortControllerRef.current?.signal?.aborted
        , []);

    const handlePaste = useCallback((e) => {
        const pasted = e.clipboardData?.getData("text") || "";
        if (pasted.length >= PASTE_CARD_THRESHOLD) {
            e.preventDefault();
            setPasteCards(prev => [...prev, { id: Date.now(), content: pasted }]);
        }
    }, []);

    const removeCard = useCallback((id) => {
        setPasteCards(prev => prev.filter(c => c.id !== id));
        setModalCardId(prev => prev === id ? null : prev);
    }, []);

    const buildPrompt = () => {
        const parts = [];
        if (inputValue.trim()) parts.push(inputValue.trim());
        pasteCards.forEach(c => parts.push(c.content));
        return parts.join("\n\n");
    };

    const canSend = (inputValue.trim() || pasteCards.length > 0) && selectedFile && !uploading && !isStreaming;

    const handleStopGenerating = useCallback(() => {
        controllerRef.current.abort();
        setIsStreaming(false);
        setIsTyping(false);
    }, []);

    const prevChatIdRef = useRef(currentChatId);

    // Reset local state when switching chats
    useEffect(() => {
        const prev = prevChatIdRef.current;
        prevChatIdRef.current = currentChatId;

        // If we are transitioning from a New Chat (null) to a saved chat, don't abort the stream!
        // The stream was just started by handleSend.
        if (prev === null && currentChatId !== null) {
            return;
        }

        if (controllerRef.current) {
            controllerRef.current.abort();
        }
        setIsStreaming(false);
        setIsTyping(false);
        activeRequestIdRef.current = null;
        reconnectingRef.current = false;
        setInputValue("");
        setPasteCards([]);
    }, [currentChatId]);

    const reconnectingRef = useRef(false);
    
    useEffect(() => {
        if (!isStreaming && messages.length > 0 && !reconnectingRef.current) {
            const lastMsg = messages[messages.length - 1];
            if (lastMsg.type === "bot" && lastMsg.extra_data) {
                try {
                    const extra = typeof lastMsg.extra_data === 'string' ? JSON.parse(lastMsg.extra_data) : lastMsg.extra_data;
                    if (extra.status === "running" && extra.task_id && !activeRequestIdRef.current) {
                        reconnectingRef.current = true;
                        const reconnectToStream = async (taskId, msgId) => {
                            const streamUrl = `${API}/chat/stream/${taskId}`;
                            setIsStreaming(true);
                            setIsTyping(true);
                            activeRequestIdRef.current = String(msgId);
                            
                            try {
                                await controllerRef.current.connectToStreamUrl(streamUrl, {
                                    Authorization: `Bearer ${token}`
                                });
                                
                                const finalState = controllerRef.current.state;
                                const finalContent = finalState.textChunks?.join('') || lastMsg.content || '';
                                const finalSteps = (finalState.steps && finalState.steps.length > 0) ? finalState.steps : (lastMsg.steps || []);
                                const finalArtifact = finalState.artifact || lastMsg.artifact;
                                
                                setMessages(prev => prev.map(m => 
                                    m.id === msgId ? {
                                        ...m,
                                        content: finalContent,
                                        steps: finalSteps,
                                        artifact: finalArtifact,
                                        extra_data: null  // Clear the "running" flag so it stops retrying
                                    } : m
                                ));
                            } catch (e) {
                                console.error("Reconnection failed", e);
                            } finally {
                                setIsStreaming(false);
                                setIsTyping(false);
                                activeRequestIdRef.current = null;
                                reconnectingRef.current = false;
                            }
                        };
                        reconnectToStream(extra.task_id, lastMsg.id);
                    }
                } catch(e) {}
            }
        }
    }, [messages, isStreaming, token, currentChatId]);

    const handleSend = async (overrideText) => {
        if (isStreaming) return;
        const text = overrideText || buildPrompt();
        if (!text.trim()) return;
        if (!selectedFile) {
            setMessages(prev => [...prev, { id: Date.now(), type: "bot", content: "Please upload or select a file first.", timestamp: new Date() }]);
            return;
        }

        const userMsg = { id: Date.now(), type: "user", content: text, timestamp: new Date() };
        setMessages(prev => [...prev, userMsg]);
        setInputValue(""); setPasteCards([]); setModalCardId(null);
        setIsTyping(true); isAtBottomRef.current = true; shouldAutoScrollRef.current = true;

        let chatId = currentChatId;
        if (!chatId) chatId = await createChat(text.slice(0, 80));

        const accessToken = localStorage.getItem("access_token");
        const headers = accessToken ? { "Authorization": `Bearer ${accessToken}` } : {};

        setIsStreaming(true);
        controllerRef.current.endpoint = `${API}/generate`;
        try {
            await controllerRef.current.send({
                prompt: userMsg.content,
                filename: selectedFile,
                chat_id: chatId,
                search_mode: searchMode,
                scope: searchScope,
                temperature: 0.4,
                max_output_tokens: 1024,
                top_p: 0.9
            }, headers);

            const finalState = controllerRef.current.state;
            if (finalState.status === 'done' || finalState.status === 'error') {
                const finalContent = finalState.textChunks?.join('') || '';
                if (finalContent || (finalState.steps && finalState.steps.length > 0) || finalState.artifact) {
                    setMessages(prev => {
                        // Let's just do a normal append.
                        // When handleSend finishes, it will append the message.
                        // But wait! If the user refreshes DURING streaming, the AppContext loads the placeholder msg.
                        return [...prev, {
                            id: Date.now(),
                            type: "bot",
                            content: finalContent,
                            steps: finalState.steps,
                            timestamp: new Date()
                        }];
                    });
                }
            }
        } catch (e) {
            console.error(e);
        } finally {
            setIsStreaming(false);
            setIsTyping(false);
            setActivePanel(null);
        }
    };

    const handleKeyDown = (e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); handleSend(); } };
    const togglePanel = (panel) => setActivePanel(prev => prev === panel ? null : panel);
    const panelOpen = activePanel !== null;
    const isEmpty = files.length === 0 && messages.length === 0;
    const hasFileButEmpty = files.length > 0 && messages.length === 0;
    const modalCard = pasteCards.find(c => c.id === modalCardId);
    const displayCount = files.length;


    const renderInputBox = () => (
        <div className="w-full">
            {selectedFile && (
                <div className="mb-2 flex items-center justify-between">
                    <button onClick={() => setShowUploadPanel(true)} className="inline-flex items-center gap-1.5 text-[10.5px] px-2.5 py-1 rounded-lg transition-all border border-[var(--border-mid)] text-[var(--text-faint)] hover:border-[var(--accent)]/40 hover:text-[var(--accent)] hover:bg-[var(--accent-dim)] bg-transparent cursor-pointer">
                        <span className="w-1.5 h-1.5 rounded-full bg-[var(--accent)]" />
                        {selectedFile}
                        {files.find(f => f.name === selectedFile)?.status === "indexing" && <span className="flex items-center gap-0.5 text-[var(--accent)]/60"><Clock size={8} />indexing</span>}
                    </button>

                    <div className="flex items-center gap-2">
                        <div className="flex items-center bg-[var(--bg-elevated)] rounded-lg p-0.5 border border-[var(--border-mid)] shadow-sm">
                            <button onClick={() => setSearchScope("active")}
                                className={`flex items-center gap-1 px-2.5 py-1 rounded-md text-[9.5px] font-semibold transition-all border-none cursor-pointer ${searchScope === "active" ? "bg-[var(--bg-panel)] text-[var(--accent)] shadow-sm" : "bg-transparent text-[var(--text-muted)] hover:text-[var(--text-primary)]"}`}>
                                <FileText size={10} /> Active
                            </button>
                            <button onClick={() => setSearchScope("all")}
                                className={`flex items-center gap-1 px-2.5 py-1 rounded-md text-[9.5px] font-semibold transition-all border-none cursor-pointer ${searchScope === "all" ? "bg-[var(--bg-panel)] text-[var(--accent)] shadow-sm" : "bg-transparent text-[var(--text-muted)] hover:text-[var(--text-primary)]"}`}>
                                <Globe size={10} /> All
                            </button>
                        </div>


                    </div>
                </div>
            )}

            <div className="chat-input-focus flex flex-col bg-[var(--bg-input)] border border-[var(--border-mid)] rounded-2xl transition-all duration-150 relative">
                {pasteCards.length > 0 && (
                    <div className="flex flex-wrap px-3 pt-3">
                        {pasteCards.map(card => (
                            <PasteChip key={card.id} card={card} onRemove={removeCard} onClick={() => setModalCardId(card.id)} />
                        ))}
                    </div>
                )}
                <textarea
                    ref={textareaRef}
                    value={inputValue}
                    onChange={e => setInputValue(e.target.value)}
                    onKeyDown={handleKeyDown}
                    onPaste={handlePaste}
                    disabled={isStreaming}
                    placeholder={pasteCards.length > 0 ? "Add a message about the pasted content…" : !selectedFile ? "How can I help you today?" : `Ask anything about ${selectedFile}…`}
                    rows={2}
                    className="flex-1 bg-transparent border-none outline-none resize-none text-[var(--text-primary)] text-[15px] leading-[1.65] px-4 pt-4 pb-1 overflow-y-auto disabled:opacity-60"
                    style={{ maxHeight: 200, caretColor: "var(--accent)" }}
                />
                <div className="flex items-center justify-between px-3 pb-3 pt-1">
                    <div className="flex items-center gap-2">
                        <button onClick={() => setShowUploadPanel(true)} disabled={uploading}
                            className={`p-2 rounded-lg bg-transparent border-none flex-shrink-0 transition-colors ${uploading ? "opacity-50 cursor-wait" : "cursor-pointer text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-elevated)]"}`}>
                            {uploading ? <Loader2 size={18} className="text-[var(--accent)] animate-spin" /> : <Plus size={18} />}
                        </button>
                        
                        <div className="flex items-center bg-[var(--bg-elevated)] rounded-lg p-0.5 border border-[var(--border-mid)] shadow-sm ml-1">
                                    <button onClick={() => setSearchMode("vector")}
                                        className={`flex items-center gap-1 px-2.5 py-1 rounded-md text-[9.5px] font-semibold transition-all border-none cursor-pointer ${searchMode === "vector" ? "bg-[var(--bg-panel)] text-[var(--multi-accent)] shadow-sm" : "bg-transparent text-[var(--text-muted)] hover:text-[var(--text-primary)]"}`}>
                                        <Search size={10} /> Vector
                                    </button>

                                    <div className="relative group">
                                        <button onClick={() => setSearchMode("tree")}
                                            className={`flex items-center gap-1 px-2.5 py-1 rounded-md text-[9.5px] font-semibold transition-all border-none cursor-pointer ${searchMode === "tree" ? "bg-[var(--bg-panel)] text-[var(--multi-accent)] shadow-sm" : "bg-transparent text-[var(--text-muted)] hover:text-[var(--text-primary)]"}`}>
                                            <Network size={10} /> Tree
                                        </button>
                                    </div>
                        </div>

                    </div>
                    <div className="flex items-center gap-2">
                        {isStreaming ? (
                            <button onClick={handleStopGenerating} className="px-3 py-1.5 rounded-lg bg-[var(--bg-elevated)] border border-[var(--border-mid)] text-[var(--text-primary)] text-[12px] cursor-pointer transition-all hover:bg-[var(--bg-panel)]">
                                Stop Generating
                            </button>
                        ) : (
                            <>
                            </>
                        )}
                        <button onClick={() => handleSend()} disabled={!canSend}
                            className={`w-8 h-8 rounded-xl flex items-center justify-center border transition-all ${canSend ? "bg-[#fff] border-[#fff] text-[#000] cursor-pointer hover:opacity-90 active:scale-90" : "bg-[var(--bg-elevated)] border-[var(--border-mid)] text-[var(--text-faint)] cursor-not-allowed opacity-50"}`}>
                            <Send size={14} />
                        </button>
                    </div>
                </div>
            </div>

            <p className="text-[10px] text-[var(--text-faint)] text-center mt-2 opacity-50">
                {displayCount > 1
                    ? `${displayCount} documents indexed · chat uses selected doc · Multi-Report analyzes all`
                    : "Answers grounded in selected document only"}
            </p>
        </div>
    );

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
                {modalCard && <PasteModal card={modalCard} onClose={() => setModalCardId(null)} />}
                {showSelectionModal && (
                    <div className="fixed inset-0 z-[200] flex items-center justify-center backdrop-blur-sm animate-[fadeIn_0.12s_ease]" style={{ background: "var(--overlay-bg)" }} onClick={() => setShowSelectionModal(false)}>
                        <div className="relative w-full max-w-3xl mx-4 bg-[var(--bg-panel)] border border-[var(--border-mid)] rounded-2xl p-6 flex flex-col gap-5 shadow-2xl animate-[fadeSlideUp_0.18s_ease]" onClick={e => e.stopPropagation()}>
                            <div className="flex items-start justify-between">
                                <div>
                                    <h2 className="text-sm font-medium text-[var(--text-primary)] m-0" style={{ fontFamily: "'Fraunces', serif", fontStyle: "italic" }}>Select Document</h2>
                                    <p className="text-[10px] text-[var(--text-faint)] mt-1 tracking-widest uppercase font-mono">Switch active document for chat</p>
                                </div>
                                <button onClick={() => setShowSelectionModal(false)} className="p-1.5 rounded-lg bg-transparent border border-[var(--border-mid)] cursor-pointer text-[var(--text-muted)] flex items-center justify-center transition-all hover:bg-[var(--bg-elevated)] hover:text-[var(--text-primary)]"><X size={13} /></button>
                            </div>

                            <div className="flex flex-col gap-1.5 max-h-[55vh] overflow-y-auto pr-2 cmti-history">
                                {files.length === 0 ? (
                                    <div className="py-12 text-center border border-dashed border-[var(--border-mid)] rounded-2xl bg-[var(--bg-base)]">
                                        <p className="text-[11px] text-[var(--text-faint)] font-mono">No documents found. Upload one to start.</p>
                                    </div>
                                ) : (
                                    files.map(f => (
                                        <div key={f.name} className={`flex items-center gap-2 px-3 py-2.5 rounded-xl border transition-all ${selectedFile === f.name ? "bg-[var(--accent-dim)] border-[var(--accent)]/40" : "border-transparent hover:bg-[var(--bg-elevated)]"}`}>
                                            <button onClick={() => { setSelectedFile(f.name); setShowSelectionModal(false); }} className={`flex items-center gap-3 flex-1 text-left bg-transparent border-none cursor-pointer text-[13px] font-mono ${selectedFile === f.name ? "text-[var(--accent)]" : "text-[var(--text-body)]"}`}>
                                                <FileText size={14} className={selectedFile === f.name ? "text-[var(--accent)]" : "text-[var(--text-faint)]"} />
                                                <span className="flex-1 truncate">{f.name}</span>
                                                {f.status === "indexing" && <span className="text-[10px] text-[var(--accent)]/60 flex items-center gap-1 animate-pulse"><Clock size={10} />indexing</span>}
                                                {selectedFile === f.name && f.status !== "indexing" && <CheckCircle size={14} className="text-[var(--accent)]" />}
                                            </button>
                                            <button onClick={e => { e.stopPropagation(); handleDeleteFile(f.name); }} className="p-2 rounded-lg bg-transparent border-none cursor-pointer text-[var(--text-faint)] hover:text-[var(--red-soft)] transition-colors" title="Delete document">
                                                <Trash2 size={13} />
                                            </button>
                                        </div>
                                    ))
                                )}
                            </div>

                            <div className="flex justify-between items-center pt-2 border-t border-[var(--border)]">
                                <span className="text-[10px] text-[var(--text-faint)] font-mono uppercase tracking-widest">{files.length} Total Documents</span>
                                <button onClick={() => { setShowSelectionModal(false); setShowUploadPanel(true); }}
                                    className="px-5 py-2.5 rounded-xl text-[11px] font-mono font-semibold bg-[var(--accent)] text-[var(--on-accent)] border-none transition-all cursor-pointer hover:opacity-90 active:scale-95 shadow-lg shadow-[var(--accent)]/20">
                                    + Upload New Document
                                </button>
                            </div>
                        </div>
                    </div>
                )}

                {/* ── Top Bar ── */}
                <header className="flex-shrink-0 flex items-center justify-end px-5 h-[52px] sticky top-0 z-[100] gap-3" style={{ backgroundColor: "var(--bg-surface)" }}>
                    <div className="flex items-center gap-1.5 mr-2">
                        {selectedFile && (
                            <>
                                <button onClick={() => togglePanel("pdf")} 
                                    className="group px-2 py-1.5 rounded-lg bg-transparent border-none cursor-pointer text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-elevated)] transition-all flex items-center gap-1.5 justify-center">
                                    <FileSearch size={18} />
                                    <span className="max-w-0 overflow-hidden whitespace-nowrap opacity-0 group-hover:max-w-xs group-hover:opacity-100 transition-all duration-300 ease-[cubic-bezier(0.4,0,0.2,1)] text-[11px] font-semibold font-mono tracking-widest uppercase">View PDF</span>
                                </button>
                                <button onClick={() => { setReportMode("single"); navigate("/report"); }} 
                                    className="group px-2 py-1.5 rounded-lg bg-transparent border-none cursor-pointer text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-elevated)] transition-all flex items-center gap-1.5 justify-center">
                                    <FileText size={18} />
                                    <span className="max-w-0 overflow-hidden whitespace-nowrap opacity-0 group-hover:max-w-xs group-hover:opacity-100 transition-all duration-300 ease-[cubic-bezier(0.4,0,0.2,1)] text-[11px] font-semibold font-mono tracking-widest uppercase">Report</span>
                                </button>
                            </>
                        )}
                    </div>
                    <ThemeToggle />
                </header>

                {/* ── Main area ── */}
                <div className="flex-1 flex overflow-hidden relative">
                    <div className={`flex flex-col overflow-hidden transition-all duration-300 ease-[cubic-bezier(0.4,0,0.2,1)] ${panelOpen ? "flex-[0_0_52%] border-r border-[var(--border)]" : "flex-1"}`}>

                        {(isEmpty || hasFileButEmpty) ? (
                            <div className="flex-1 flex flex-col items-center justify-center px-4 animate-[fadeSlideUp_0.3s_ease] pb-[10vh]">
                                <div className="text-center mb-8">
                                    <h1 className="text-[32px] font-medium text-[var(--text-primary)] m-0 flex items-center justify-center" style={{ fontFamily: "ui-serif, Georgia, Cambria, 'Times New Roman', Times, serif" }}>
                                        {(() => {
                                            const hour = new Date().getHours();
                                            if (hour < 12) return 'Good morning';
                                            if (hour < 18) return 'Good afternoon';
                                            return 'Good evening';
                                        })()}, {user?.username?.split(' ')[0] || user?.email?.split('@')[0] || 'User'}
                                    </h1>
                                </div>

                                <div className="w-full max-w-[720px]">
                                    {renderInputBox()}

                                </div>
                            </div>
                        ) : (
                            <>
                                <div ref={scrollContainerRef} onScroll={handleScroll} className="relative flex-1 overflow-y-auto px-4 pt-8 pb-4 flex flex-col">
                                    <div className="max-w-[720px] w-full mx-auto flex flex-col gap-7">
                                        {messages.filter(msg => {
                                            if (!isStreaming) return true;
                                            try {
                                                const extra = typeof msg.extra_data === 'string' ? JSON.parse(msg.extra_data) : msg.extra_data;
                                                if (extra && extra.status === "running") return false;
                                            } catch(e) {}
                                            return true;
                                        }).map((msg, idx) => (
                                            <div key={msg.id}
                                                className={`msg-row flex ${msg.type === "user" ? "justify-end cb-msg-user" : "justify-start cb-msg-bot"}`}
                                                style={{ animationDelay: `${Math.min(idx * 0.03, 0.18)}s`, animationFillMode: "both" }}>
                                                {msg.type === "user"
                                                    ? (
                                                        <div className="flex flex-col items-end gap-1.5 max-w-[75%]">
                                                            <div className="bg-[var(--bg-elevated)] border border-[var(--border-mid)] text-[var(--text-primary)] px-4 py-3 rounded-[18px_18px_4px_18px] text-[15px] leading-[1.7] whitespace-pre-wrap break-words">{msg.content}</div>
                                                            <div className="msg-copy-btn"><CopyButton text={msg.content} /></div>
                                                        </div>
                                                    )
                                                    : (
                                                        <div className="flex gap-3 max-w-full items-start w-full">
                                                            <div className="w-7 h-7 rounded-lg flex-shrink-0 bg-[var(--accent-dim)] border border-[var(--accent)]/25 flex items-center justify-center mt-1">
                                                                <span className="text-[var(--accent)] text-xs">◈</span>
                                                            </div>
                                                            <div className="flex-1 min-w-0 overflow-x-hidden">
                                                                {msg.thinkDone && msg.thinking && <ThinkBlock thinking={msg.thinking} done={msg.thinkDone} />}
                                                                {msg.steps && msg.steps.length > 0 && <StepsSidebar steps={msg.steps} />}
                                                                {msg.artifact && (
                                                                    <div className="mb-3 mt-1">
                                                                        <button
                                                                            onClick={() => setActiveArtifact(msg.artifact)}
                                                                            className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-[var(--accent-dim)] border border-[var(--accent)]/30 text-[var(--accent)] text-[12px] font-mono hover:bg-[var(--accent)]/10 cursor-pointer transition-colors">
                                                                            <Code size={14} />
                                                                            View Generated Artifact ({msg.artifact.lang || 'code'})
                                                                        </button>
                                                                    </div>
                                                                )}
                                                                {(() => {
                                                                    if (!msg.content) {
                                                                        return (isTyping && idx === messages.length - 1) ? <TypingDots /> : null;
                                                                    }
                                                                    let displayContent = msg.content;
                                                                    if (msg.artifact && msg.artifact.code) {
                                                                        displayContent = displayContent.replace(/```\w*\s*\n[\s\S]*?(```|$)/, "\n> *Code displayed in Artifact Panel*\n");
                                                                    }
                                                                    return (
                                                                        <>
                                                                            <MarkdownMessage content={displayContent} onCitationClick={handleCitationClick} />
                                                                            <div className="msg-copy-btn mt-1"><CopyButton text={msg.content} /></div>
                                                                        </>
                                                                    );
                                                                })()}
                                                            </div>
                                                        </div>
                                                    )}
                                            </div>
                                        ))}

                                        {isStreaming && (
                                            <div className="msg-row flex justify-start cb-msg-bot">
                                                <div className="flex gap-3 max-w-full items-start w-full">
                                                    <div className="w-7 h-7 rounded-lg flex-shrink-0 bg-[var(--accent-dim)] border border-[var(--accent)]/25 flex items-center justify-center mt-1">
                                                        <span className="text-[var(--accent)] text-xs">◈</span>
                                                    </div>
                                                    <div className="flex-1 min-w-0 overflow-x-hidden">
                                                        {uiState.steps && uiState.steps.length > 0 && (
                                                            <div className="mb-4">
                                                                <StepsSidebar steps={uiState.steps} />
                                                            </div>
                                                        )}
                                                        {(() => {
                                                            if (!uiState.textChunks || uiState.textChunks.length === 0) {
                                                                return <TypingDots />;
                                                            }
                                                            const fullContent = uiState.textChunks.join("");
                                                            let displayContent = fullContent;
                                                            if (uiState.artifact && (uiState.artifact.code || uiState.artifact.open)) {
                                                                displayContent = displayContent.replace(/```\w*\s*\n[\s\S]*?(```|$)/, "\n> *Code displayed in Artifact Panel*\n");
                                                            }
                                                            return <MarkdownMessage content={displayContent} />;
                                                        })()}
                                                    </div>
                                                </div>
                                            </div>
                                        )}
                                        <div className="h-px" />
                                    </div>

                                    <div className="absolute right-4 bottom-4 z-20 flex flex-col gap-2">
                                        {isAtTop && !isAtBottom && (
                                            <button onClick={() => { shouldAutoScrollRef.current = true; scrollToBottom("smooth"); }} title="Scroll to latest"
                                                className="w-9 h-9 rounded-full bg-[var(--bg-elevated)] border border-[var(--border-mid)] text-[var(--text-muted)] cursor-pointer shadow-lg transition-all hover:border-[var(--accent)]/40 flex items-center justify-center">
                                                <ArrowDown size={14} />
                                            </button>
                                        )}
                                        {isAtBottom && !isAtTop && (
                                            <button onClick={() => scrollToTop("smooth")} title="Scroll to first"
                                                className="w-9 h-9 rounded-full bg-[var(--bg-elevated)] border border-[var(--border-mid)] text-[var(--text-muted)] cursor-pointer shadow-lg transition-all hover:border-[var(--accent)]/40 flex items-center justify-center">
                                                <ArrowUp size={14} />
                                            </button>
                                        )}
                                    </div>
                                </div>

                                <div className="flex-shrink-0 px-4 pb-6 pt-2" style={{ backgroundColor: "var(--bg-surface)" }}>
                                    <div className="max-w-[720px] mx-auto">
                                        {renderInputBox()}
                                    </div>
                                </div>
                            </>
                        )}
                        {/* ── Viewers ── */}
                    </div>

                    {(activeArtifact || (uiState.artifact && uiState.artifact.open !== undefined && isStreaming)) && (
                        <ArtifactPanel
                            artifact={activeArtifact || uiState.artifact}
                            onClose={closeArtifact}
                        />
                    )}
                    {activePanel === "pdf" && selectedFile && (
                        <div className="flex-[0_0_48%] min-w-0 overflow-hidden flex flex-col animate-[fadeIn_0.18s_ease]">
                            <PdfViewerPanel filename={selectedFile} pdfPage={pdfPage} onClose={() => setActivePanel(null)} />
                        </div>
                    )}
                </div>
            </div>
        </>
    );
};

export default Chatbot;