/**
 * AppContext.jsx — Modular state management for RAGBOT.
 * Deconstructs the monolithic context into focused Providers: Sidebar, File, Chat, and Report.
 */

import React, { createContext, useContext, useState, useCallback, useEffect, useRef, useMemo } from "react";
import axios from "axios";
import { toast } from "react-hot-toast";
import { useAuth } from "./AuthContext";

export const API = "http://127.0.0.1:8080";

// ─── GRANULAR CONTEXTS ────────────────────────────────────────
const SidebarContext = createContext(null);
const FileContext = createContext(null);
const ChatContext = createContext(null);
const ReportContext = createContext(null);

export const useSidebar = () => {
    const ctx = useContext(SidebarContext);
    if (!ctx) throw new Error("useSidebar must be used within SidebarProvider");
    return ctx;
};

export const useFileStore = () => {
    const ctx = useContext(FileContext);
    if (!ctx) throw new Error("useFileStore must be used within FileProvider");
    return ctx;
};

export const useChatStore = () => {
    const ctx = useContext(ChatContext);
    if (!ctx) throw new Error("useChatStore must be used within ChatProvider");
    return ctx;
};

export const useReportStore = () => {
    const ctx = useContext(ReportContext);
    if (!ctx) throw new Error("useReportStore must be used within ReportProvider");
    return ctx;
};

// (useApp has been removed for performance optimization)
// ─── 1. SIDEBAR PROVIDER ──────────────────────────────────────
export function SidebarProvider({ children }) {
    const { user, syncPreferences } = useAuth();
    const [sidebarOpen, setSidebarOpen] = useState(() => {
        const stored = user?.preferences?.sidebarOpen ?? localStorage.getItem("sidebarOpen");
        return stored === "true";
    });

    const toggleSidebar = useCallback(() => {
        setSidebarOpen(prev => {
            const next = !prev;
            syncPreferences({ sidebarOpen: String(next) });
            return next;
        });
    }, []);

    const sidebarContextValue = React.useMemo(() => ({
        sidebarOpen, setSidebarOpen, toggleSidebar
    }), [sidebarOpen, toggleSidebar]);

    return (
        <SidebarContext.Provider value={sidebarContextValue}>
            {children}
        </SidebarContext.Provider>
    );
}

// ─── 2. FILE PROVIDER ─────────────────────────────────────────
export function FileProvider({ children }) {
    const { token, user, syncPreferences } = useAuth();

    // Helper to safely load JSON-structured preferences
    const getParsedPref = useCallback((key, defaultVal) => {
        const pref = user?.preferences?.[key];
        if (pref !== undefined && pref !== null) return pref;
        try {
            const local = localStorage.getItem(key);
            if (local) return JSON.parse(local);
        } catch { }
        return defaultVal;
    }, [user?.preferences]);

    const [files, setFiles] = useState([]);
    const [selectedFile, setSelectedFile] = useState(() => {
        return user?.preferences?.selectedFile || "";
    });
    const [selectedFiles, setSelectedFiles] = useState(() => {
        const pref = user?.preferences?.selectedFiles;
        return (pref !== undefined && pref !== null && Array.isArray(pref)) ? pref : [];
    });

    // Sync to user preferences
    useEffect(() => {
        if (selectedFile) syncPreferences({ selectedFile });
    }, [selectedFile, syncPreferences]);

    useEffect(() => {
        syncPreferences({ selectedFiles });
    }, [selectedFiles, syncPreferences]);

    const [uploadingCount, setUploadingCount] = useState(0);
    const [uploadProgress, setUploadProgress] = useState("Uploading…");
    const pollingRef = useRef(null);

    const fetchFiles = useCallback(async () => {
        try {
            const res = await axios.get(`${API}/files`);
            const raw = res.data.files || [];

            // Deduplicate files by display_name to prevent duplicate renders
            const uniqueFiles = new Map();
            raw.forEach((f) => {
                const dName = f.display_name || f.name;
                // If conflict, prefer the one with a user prefix (has a number)
                if (!uniqueFiles.has(dName) || /^\\d+_/.test(f.name)) {
                    uniqueFiles.set(dName, {
                        name: f.name,
                        display_name: dName,
                        status: f.status || "ready"
                    });
                }
            });
            const list = Array.from(uniqueFiles.values());

            setFiles(list);

            if (list.length > 0) {
                setSelectedFile((prev) => prev || list[0].name);
                setSelectedFiles((prev) => {
                    const safePrev = Array.isArray(prev) ? prev : [];
                    return safePrev.length === 0 ? list.map((f) => f.name) : safePrev;
                });
            }
        } catch (e) {
            console.error("[FILE-STORE] Failed to fetch files:", e);
        }
    }, []);

    useEffect(() => {
        fetchFiles();
    }, [fetchFiles, token]);

    // Poll indexing files every 3s
    useEffect(() => {
        const indexing = files.filter((f) => f.status === "indexing");
        if (indexing.length === 0) return;
        pollingRef.current = setInterval(async () => {
            let changed = false;
            const updated = await Promise.all(
                files.map(async (f) => {
                    if (f.status !== "indexing") return f;
                    try {
                        const res = await axios.get(`${API}/status/${encodeURIComponent(f.name)}`);
                        if (res.data.status !== f.status) changed = true;
                        return { ...f, status: res.data.status };
                    } catch { return f; }
                })
            );
            if (changed) {
                setFiles(updated);
                setSelectedFiles((prev) => {
                    const readyNames = updated.filter(f => f.status === "ready").map(f => f.name);
                    const merged = [...new Set([...prev, ...readyNames])];
                    localStorage.setItem("selectedFiles", JSON.stringify(merged));
                    return merged;
                });
            }
        }, 3000);
        return () => clearInterval(pollingRef.current);
    }, [files]);

    const handleUploadFile = useCallback(async (file) => {
        if (!file) return;
        const ext = "." + file.name.split(".").pop().toLowerCase();
        if (![".pdf", ".txt"].includes(ext)) {
            toast.error("Only PDF and TXT files are supported.");
            return;
        }
        setUploadingCount(prev => prev + 1);
        setUploadProgress(`Uploading ${file.name}…`);
        const formData = new FormData();
        formData.append("file", file);
        try {
            const progressTimer = setTimeout(() => setUploadProgress(`Indexing ${file.name}…`), 1500);
            const res = await axios.post(`${API}/upload`, formData, {
                headers: { "Content-Type": "multipart/form-data" },
            });
            clearTimeout(progressTimer);
            const uploaded = res.data.file;
            await fetchFiles();
            setSelectedFile(uploaded);
            syncPreferences({ selectedFile: uploaded });

            setSelectedFiles((prev) => {
                const next = prev.includes(uploaded) ? prev : [...prev, uploaded];
                syncPreferences({ selectedFiles: next });
                return next;
            });
            toast.success(`"${res.data.display_name || uploaded}" uploaded and indexed successfully.`);
        } catch (err) {
            toast.error(`Upload failed for ${file.name}: ${err.response?.data?.error || err.message}`);
        } finally {
            setUploadingCount(prev => Math.max(0, prev - 1));
        }
    }, [fetchFiles]);

    const handleReindex = useCallback(async (filename) => {
        try {
            await axios.post(`${API}/reindex`, { filename });
            setFiles((prev) => prev.map((f) => f.name === filename ? { ...f, status: "indexing" } : f));
            toast.success(`Re-indexing "${filename}" started.`);
        } catch (err) {
            toast.error(`Re-index failed: ${err.response?.data?.error || err.message}`);
        }
    }, []);

    const handleDeleteFile = useCallback(async (filename) => {
        if (!window.confirm(`Permanently delete "${filename}"? This removes the index and file.`)) return;
        try {
            const res = await axios.post(`${API}/delete`, { filename });
            if (res.data.status === "deleted" || res.data.status === "success") {
                setFiles((prev) => {
                    const remaining = prev.filter((f) => f.name !== filename);
                    if (selectedFile === filename) {
                        const nextSelected = remaining[0]?.name || "";
                        setSelectedFile(nextSelected);
                        syncPreferences({ selectedFile: nextSelected });
                    }
                    return remaining;
                });
                setSelectedFiles((prev) => {
                    const next = prev.filter((n) => n !== filename);
                    syncPreferences({ selectedFiles: next });
                    return next;
                });
                toast.success(`"${filename}" has been permanently deleted.`);
            }
        } catch (err) {
            toast.error(`Failed to delete file: ${err.response?.data?.error || err.message}`);
        }
    }, [selectedFile]);

    const toggleFileSelection = useCallback((filename) => {
        setSelectedFiles((prev) => {
            const next = prev.includes(filename) ? prev.filter((n) => n !== filename) : [...prev, filename];
            syncPreferences({ selectedFiles: next });
            return next;
        });
    }, []);

    const selectAllFiles = useCallback(() => {
        const next = files.map(f => f.name);
        setSelectedFiles(next);
        syncPreferences({ selectedFiles: next });
    }, [files]);

    const clearFileSelection = useCallback(() => {
        setSelectedFiles([]);
        syncPreferences({ selectedFiles: [] });
    }, []);

    const getFileUrl = useCallback((filename) => {
        if (!filename) return null;
        const encoded = filename.split("/").map((seg) => encodeURIComponent(seg)).join("/");
        const accessToken = token || localStorage.getItem("access_token");
        return accessToken
            ? `${API}/file/${encoded}?token=${encodeURIComponent(accessToken)}`
            : `${API}/file/${encoded}`;
    }, [token]);

    const fileContextValue = React.useMemo(() => ({
        files, setFiles, selectedFile, setSelectedFile: (f) => { setSelectedFile(f); syncPreferences({ selectedFile: f }); },
        uploading: uploadingCount > 0, uploadProgress, fetchFiles,
        handleUploadFile, handleReindex, handleDeleteFile, getFileUrl,
        selectedFiles, setSelectedFiles, toggleFileSelection, selectAllFiles, clearFileSelection
    }), [files, selectedFile, uploadingCount, uploadProgress, fetchFiles, handleUploadFile, handleReindex, handleDeleteFile, getFileUrl, selectedFiles, setSelectedFiles, toggleFileSelection, selectAllFiles, clearFileSelection]);

    return (
        <FileContext.Provider value={fileContextValue}>
            {children}
        </FileContext.Provider>
    );
}

// ─── 3. CHAT PROVIDER ─────────────────────────────────────────
export function ChatProvider({ children }) {
    const { isAuthenticated, loading: authLoading, user, syncPreferences } = useAuth();
    const [chats, setChats] = useState([]);
    const [currentChatId, setCurrentChatId] = useState(null);
    const [messages, setMessages] = useState([]);

    const persistCurrentChatId = useCallback((chatId) => {
        if (chatId) {
            localStorage.setItem("currentChatId", String(chatId));
            syncPreferences({ currentChatId: String(chatId) });
        } else {
            localStorage.removeItem("currentChatId");
            syncPreferences({ currentChatId: null });
        }
    }, [syncPreferences]);

    const replayStreamEvents = useCallback((events = []) => {
        const replay = { content: "", steps: [], artifact: null };

        const finishRunningStep = () => {
            const running = replay.steps.find(s => s.status === "running");
            if (running) running.status = "done";
        };

        for (const ev of events) {
            if (ev.type === "content_block_start" && ev.content_block?.type === "tool_use") {
                replay.steps.push({
                    id: ev.content_block.id || `${Date.now()}-${replay.steps.length}`,
                    name: ev.content_block.name,
                    status: "running",
                    inputJson: "",
                });
            } else if (ev.type === "content_block_delta") {
                if (ev.delta?.type === "text_delta") {
                    replay.content += ev.delta.text || "";
                } else if (ev.delta?.type === "input_json_delta") {
                    const step = replay.steps[replay.steps.length - 1];
                    if (step && step.status === "running") {
                        step.inputJson += ev.delta.partial_json || "";
                    }
                }
            } else if (ev.type === "content_block_stop" || ev.type === "message_stop") {
                finishRunningStep();
            } else if (ev.type === "sub_task_start") {
                replay.steps.push({ id: ev.task_id || `${Date.now()}-${replay.steps.length}`, name: `Task: ${ev.instruction}`, status: "running", inputJson: "" });
            } else if (ev.type === "thought") {
                replay.steps.push({ id: `${Date.now()}-${replay.steps.length}`, name: "Thinking...", status: "done", isThought: true, inputJson: ev.content?.trim() || "" });
            } else if (ev.type === "tool_use") {
                replay.steps.push({ id: `${Date.now()}-${replay.steps.length}`, name: ev.name, status: "running", inputJson: JSON.stringify(ev.input, null, 2) });
            } else if (ev.type === "tool_result" || ev.type === "sub_task_end") {
                finishRunningStep();
                if (ev.type === "tool_result" && ["generate_latex_artifact", "generate_comprehensive_report"].includes(ev.name) && ev.result) {
                    try {
                        const parsed = JSON.parse(ev.result);
                        if (parsed.artifact_type === "latex") {
                            replay.artifact = { lang: "latex", code: parsed.content, open: false };
                        }
                    } catch { }
                }
            } else if (ev.type === "final_answer") {
                replay.content += ev.content || "";
            }
        }

        return replay;
    }, []);

    const fetchChats = useCallback(async () => {
        try {
            const res = await axios.get(`${API}/chats`);
            const chatList = res.data?.chats || [];
            setChats(chatList);
            return chatList;
        } catch (e) {
            console.error("[CHAT-STORE] Failed to fetch chats:", e);
            return null;
        }
    }, []);

    const loadChat = useCallback(async (chatId) => {
        if (!chatId) {
            setCurrentChatId(null);
            setMessages([]);
            persistCurrentChatId(null);
            return;
        }
        try {
            const res = await axios.get(`${API}/chat/${chatId}`);

            const incoming = (res.data?.messages || []).map((m) => {
                let parsedSteps = [];
                let parsedArtifact = null;
                let parsedContent = "";

                if (m.extra_data) {
                    try {
                        const extra = JSON.parse(m.extra_data);
                        if (extra.events && Array.isArray(extra.events)) {
                            const replay = replayStreamEvents(extra.events);
                            parsedContent = replay.content;
                            parsedSteps = replay.steps;
                            parsedArtifact = replay.artifact;
                        }
                    } catch (e) { console.error("Failed to parse extra_data", e); }
                }

                if (!parsedArtifact && m.content) {
                    const match = m.content.match(/```(\w*)\s*\n([\s\S]*?)```/);
                    if (match) {
                        parsedArtifact = { lang: match[1] || 'text', code: match[2].trim(), open: false };
                    }
                }

                return {
                    id: m.id,
                    type: m.role === "assistant" ? "bot" : "user",
                    content: m.content || parsedContent,
                    steps: parsedSteps,
                    artifact: parsedArtifact,
                    extra_data: m.extra_data,
                    timestamp: m.timestamp ? new Date(m.timestamp) : new Date(),
                };
            });

            setCurrentChatId(chatId);
            setMessages(incoming);
            persistCurrentChatId(chatId);
        } catch (e) {
            console.error("[CHAT-STORE] Failed to load chat:", e);
        }
    }, [persistCurrentChatId, replayStreamEvents]);

    const createChat = useCallback(async (title = "New Chat") => {
        try {
            const res = await axios.post(`${API}/chat`, { title });
            const chat = res.data?.chat;
            if (!chat) return null;
            setChats((prev) => [chat, ...prev]);
            setCurrentChatId(chat.id);
            persistCurrentChatId(chat.id);
            return chat.id;
        } catch (e) {
            console.error("[CHAT-STORE] Failed to create chat:", e);
            return null;
        }
    }, [persistCurrentChatId]);

    const deleteChat = useCallback(async (chatId) => {
        try {
            await axios.delete(`${API}/chat/${chatId}`);
            const nextChats = chats.filter((c) => c.id !== chatId);
            setChats(nextChats);
            if (currentChatId === chatId) {
                if (nextChats.length > 0) {
                    await loadChat(nextChats[0].id);
                } else {
                    setCurrentChatId(null);
                    setMessages([]);
                    persistCurrentChatId(null);
                }
            }
        } catch (e) {
            console.error("[CHAT-STORE] Failed to delete chat:", e);
            throw e;
        }
    }, [chats, currentChatId, loadChat, persistCurrentChatId]);

    useEffect(() => {
        if (authLoading) return;
        const bootstrap = async () => {
            if (!isAuthenticated) {
                setChats([]);
                setCurrentChatId(null);
                setMessages([]);
                persistCurrentChatId(null);
                return;
            }
            const list = await fetchChats();
            if (!list || list.length === 0) {
                setCurrentChatId(null);
                setMessages([]);
                persistCurrentChatId(null);
                return;
            }
            const storedRaw = user?.preferences?.currentChatId || localStorage.getItem("currentChatId");
            const storedId = storedRaw ? Number(storedRaw) : null;
            const chatToLoad = list.find((c) => c.id === storedId)?.id || list[0].id;
            await loadChat(chatToLoad);
        };
        bootstrap();
    }, [authLoading, isAuthenticated, fetchChats, loadChat, persistCurrentChatId]);

    const resetChat = useCallback(() => { setMessages([]); }, []);

    const startNewChat = useCallback(() => {
        setCurrentChatId(null);
        persistCurrentChatId(null);
        setMessages([]);
    }, [persistCurrentChatId]);

    const addChatToHistory = useCallback(async (title) => {
        if (!title || title.trim() === "") return null;
        return createChat(title.substring(0, 80));
    }, [createChat]);

    const setActiveChat = useCallback((chatId) => {
        setCurrentChatId(chatId || null);
        persistCurrentChatId(chatId || null);
    }, [persistCurrentChatId]);

    const chatContextValue = React.useMemo(() => ({
        chats, setChats, currentChatId, setCurrentChatId,
        fetchChats, createChat, chatHistory: chats, activeChat: currentChatId,
        setActiveChat, startNewChat, addChatToHistory, loadChat, deleteChat,
        messages, setMessages, resetChat
    }), [chats, setChats, currentChatId, setCurrentChatId,
        fetchChats, createChat, setActiveChat, startNewChat, addChatToHistory, loadChat, deleteChat,
        messages, setMessages, resetChat]);

    return (
        <ChatContext.Provider value={chatContextValue}>
            {children}
        </ChatContext.Provider>
    );
}

// ─── 4. REPORT PROVIDER ───────────────────────────────────────
export function ReportProvider({ children }) {
    const { token, user, syncPreferences } = useAuth();
    const getParsedPref = (key, defaultVal) => {
        const pref = user?.preferences?.key;
        return (pref !== undefined && pref !== null) ? pref : defaultVal;
    };
    const fileContext = useContext(FileContext);
    const selectedFile = fileContext?.selectedFile || "";
    const selectedFiles = fileContext?.selectedFiles || [];
    const files = fileContext?.files || [];

    const [reportLatex, setReportLatex] = useState(() => user?.preferences?.rp_latex || "");
    const [reportSections, setReportSections] = useState(() => {
        const pref = user?.preferences?.rp_sections;
        return (pref !== undefined && pref !== null && Array.isArray(pref)) ? pref : [];
    });
    const [reportQuery, setReportQuery] = useState(() => user?.preferences?.rp_query || "");
    const [reportTitle, setReportTitle] = useState(() => user?.preferences?.rp_title || "");
    const [reportMode, setReportMode] = useState(() => user?.preferences?.rp_mode || "single");
    const [reportDocResults, setReportDocResults] = useState(() => {
        const pref = user?.preferences?.rp_doc_results;
        return (pref !== undefined && pref !== null && Array.isArray(pref)) ? pref : [];
    });

    const [reportLiveLog, setReportLiveLog] = useState(() => {
        const pref = user?.preferences?.rp_livelog;
        return (pref !== undefined && pref !== null && Array.isArray(pref)) ? pref : [];
    });
    const [reportActiveStep, setReportActiveStep] = useState(() => {
        const s = user?.preferences?.rp_activestep; return s ? parseInt(s, 10) : -1;
    });
    const [reportDetectedMeta, setReportDetectedMeta] = useState(() => {
        const pref = user?.preferences?.rp_detectedmeta;
        return (pref !== undefined && pref !== null) ? pref : null;
    });
    const [reportDocStatus, setReportDocStatus] = useState(() => {
        const pref = user?.preferences?.rp_docstatus;
        return (pref !== undefined && pref !== null && Array.isArray(pref)) ? pref : [];
    });
    const [reportLocalQuery, setReportLocalQuery] = useState(() => user?.preferences?.rp_localquery || "");
    const [reportLeftTab, setReportLeftTab] = useState(() => user?.preferences?.rp_lefttab || "outline");
    const [reportQueryHint, setReportQueryHint] = useState(() => user?.preferences?.rp_query_hint_v6 || "");
    const [reportTreeType, setReportTreeType] = useState(() => user?.preferences?.rp_treetype || "tree");
    const [reportApproach, setReportApproach] = useState(() => user?.preferences?.rp_approach || "tree");

    const [reportLoading, setReportLoading] = useState(false);
    const [reportError, setReportError] = useState("");
    const [reportRateLimitMsg, setReportRateLimitMsg] = useState("");
    const [reportPdfUrl, setReportPdfUrl] = useState(null);
    const [reportCompiling, setReportCompiling] = useState(false);
    const [reportCompileError, setReportCompileError] = useState("");

    const pdfUrlRef = useRef(null);

    useEffect(() => { syncPreferences({ "rp_latex": reportLatex }); }, [reportLatex, syncPreferences]);
    useEffect(() => { syncPreferences({ "rp_sections": reportSections }); }, [reportSections, syncPreferences]);
    useEffect(() => { syncPreferences({ "rp_query": reportQuery }); }, [reportQuery, syncPreferences]);
    useEffect(() => { syncPreferences({ "rp_title": reportTitle }); }, [reportTitle, syncPreferences]);
    useEffect(() => { syncPreferences({ "rp_mode": reportMode }); }, [reportMode, syncPreferences]);
    useEffect(() => { syncPreferences({ "rp_doc_results": reportDocResults }); }, [reportDocResults, syncPreferences]);
    useEffect(() => { syncPreferences({ "rp_livelog": reportLiveLog }); }, [reportLiveLog, syncPreferences]);
    useEffect(() => { syncPreferences({ "rp_activestep": String(reportActiveStep) }); }, [reportActiveStep, syncPreferences]);
    useEffect(() => { syncPreferences({ "rp_detectedmeta": reportDetectedMeta }); }, [reportDetectedMeta, syncPreferences]);
    useEffect(() => { syncPreferences({ "rp_docstatus": reportDocStatus }); }, [reportDocStatus, syncPreferences]);
    useEffect(() => { syncPreferences({ "rp_localquery": reportLocalQuery }); }, [reportLocalQuery, syncPreferences]);
    useEffect(() => { syncPreferences({ "rp_lefttab": reportLeftTab }); }, [reportLeftTab, syncPreferences]);
    useEffect(() => { syncPreferences({ "rp_treetype": reportTreeType }); }, [reportTreeType, syncPreferences]);
    useEffect(() => { syncPreferences({ "rp_approach": reportApproach }); }, [reportApproach, syncPreferences]);

    const SESSION_HINT_KEY = "rp_query_hint_v6";
    const MAX_RETRIES = 3;
    const RETRY_DELAYS = [2000, 5000, 12000];

    const persistHint = useCallback((v) => {
        setReportQueryHint(v);
        try { syncPreferences({ [SESSION_HINT_KEY]: v }); } catch { return; }
    }, [syncPreferences]);

    const pushLog = useCallback((icon, label, done = false) => {
        setReportLiveLog(p => [...p, { icon, label, done, ts: Date.now() }]);
    }, []);

    const cleanName = (s = "") =>
        s.replace(/_pdf$/i, "").replace(/\.pdf$/i, "").replace(/_/g, " ").trim();

    const handleSingleSSEEvent = useCallback((type, data) => {
        switch (type) {
            case "start": setReportActiveStep(0); setReportRateLimitMsg(""); pushLog("⬡", `Started: ${cleanName(data.filename || "")}`); break;
            case "structure": setReportActiveStep(1); setReportDetectedMeta({ material: data.material || "—", heat: data.heat || "—", sections_found: data.sections_found || [], total_chunks: data.total_chunks || 0 }); pushLog("◈", `${(data.sections_found || []).length} sections · ${data.total_chunks || 0} chunks`); break;
            case "section_start": setReportActiveStep(2); pushLog("⟁", `Extracting: ${data.display_name || data.section_key}`); break;
            case "section_extracted": setReportActiveStep(3); pushLog("▦", `LaTeX: ${data.display_name || data.section_key}`); break;
            case "section_done": pushLog("✓", `Done: ${data.display_name || data.section_key}`, true); break;
            case "section_ready": setReportSections(p => p.find(s => s.section_key === data.section_key) ? p : [...p, data]); break;
            case "assembling": setReportActiveStep(4); pushLog("⊟", `Assembling ${data.section_count || "?"} sections…`); break;
            case "rate_limit": setReportRateLimitMsg(`Rate limit — retrying in ${data.retry_after || "?"}s`); pushLog("⏳", `Rate limit — waiting ${data.retry_after || "?"}s`); break;
            case "done": setReportActiveStep(5); setReportLatex(data.latex || ""); setReportLoading(false); setReportRateLimitMsg(""); setReportLeftTab("outline"); pushLog("✦", `Complete — ${(data.char_count || 0).toLocaleString()} chars`, true); break;
            case "heartbeat": if ((data.tick || 0) > 4) pushLog("·", `Still processing… (${((data.tick || 0) * 15)}s)`); break;
            case "error": setReportError(data.message || "Unknown error"); setReportLoading(false); setReportActiveStep(-1); break;
            default: break;
        }
    }, [pushLog, setReportSections]);

    const handleMultiSSEEvent = useCallback((type, data) => {
        switch (type) {
            case "start":
                setReportActiveStep(0); setReportRateLimitMsg("");
                pushLog("⬡", `Analyzing ${data.doc_count || 0} documents for: "${data.query || ""}"`);
                if (data.filenames) setReportDocStatus(data.filenames.map(fn => ({ filename: fn, done: false, found: false })));
                break;
            case "doc_start": setReportActiveStep(1); pushLog("◈", `Analyzing: ${cleanName(data.filename || "")}`); break;
            case "doc_batch":
                setReportActiveStep(2);
                pushLog("▦", `${cleanName(data.filename || "")} — extracting batch ${data.batch || 1}/${data.total || 1}`);
                break;
            case "doc_done":
                setReportDocStatus(prev => prev.map(d => d.filename === data.filename ? { ...d, done: true, found: !!data.found } : d));
                pushLog("✓", `${cleanName(data.filename || "")} — ${data.found ? `data found (${data.relevance || 'high'})` : "no data"}`, true);
                break;
            case "assembling": setReportActiveStep(3); pushLog("⊟", `Synthesizing ${data.section_count || "?"} document results…`); break;
            case "rate_limit": setReportRateLimitMsg(`Rate limit — retrying in ${data.retry_after || "?"}s`); pushLog("⏳", `Rate limit — waiting ${data.retry_after || "?"}s`); break;
            case "done":
                setReportActiveStep(4); setReportLatex(data.latex || ""); setReportLoading(false); setReportRateLimitMsg(""); setReportLeftTab("outline");
                if (data.doc_results) setReportDocResults(data.doc_results);
                pushLog("✦", `Complete — ${(data.char_count || 0).toLocaleString()} chars · ${data.doc_count || 0} docs`, true);
                break;
            case "heartbeat": if ((data.tick || 0) > 4) pushLog("·", `Still processing… (${((data.tick || 0) * 15)}s)`); break;
            case "error": setReportError(data.message || "Unknown error"); setReportLoading(false); setReportActiveStep(-1); break;
            default: break;
        }
    }, [pushLog, setReportDocResults]);

    const generateSingle = useCallback(() => {
        if (!selectedFile || reportLoading) return;
        setReportLoading(true); setReportError(""); setReportLatex(""); setReportPdfUrl(null);
        setReportCompileError(""); setReportLiveLog([]);
        setReportSections([]); setReportDetectedMeta(null); setReportActiveStep(-1); setReportRateLimitMsg("");
        setReportLeftTab("log");
        const body = JSON.stringify({ filename: selectedFile, standard_hint: reportQueryHint.trim(), query_hint: reportQueryHint.trim(), material_name: "", heat_number: "", document_no: "", tree_type: reportTreeType, search_approach: reportApproach });
        let retryCount = 0;
        const connect = () => {
            const accessToken = localStorage.getItem("access_token");
            const headers = { "Content-Type": "application/json" };
            if (accessToken) headers.Authorization = `Bearer ${accessToken}`;
            fetch(`${API}/generate-report`, { method: "POST", headers, body })
                .then(res => {
                    if (!res.ok) return res.json().then(e => { throw new Error(e.error || `HTTP ${res.status}`); });
                    const reader = res.body.getReader(), dec = new TextDecoder();
                    let buf = "";
                    const pump = () => reader.read().then(({ done, value }) => {
                        if (done) { setReportLoading(p => { if (p) setReportError("Stream ended unexpectedly"); return false; }); return; }
                        buf += dec.decode(value, { stream: true });
                        const lines = buf.split("\n"); buf = lines.pop();
                        for (const line of lines) {
                            if (!line.startsWith("data: ")) continue;
                            try { const { type, ...rest } = JSON.parse(line.slice(6)); handleSingleSSEEvent(type, rest); } catch { continue; }
                        }
                        pump();
                    });
                    pump();
                })
                .catch(err => {
                    const is429 = err.message?.includes("429") || err.message?.toLowerCase().includes("rate");
                    if (retryCount < MAX_RETRIES) {
                        const delay = is429 ? RETRY_DELAYS[Math.min(retryCount, 2)] * 2 : RETRY_DELAYS[retryCount];
                        setReportRateLimitMsg(`Rate limited — retrying in ${delay / 1000}s…`); pushLog("⏳", `Retrying in ${delay / 1000}s`);
                        retryCount++; setTimeout(connect, delay);
                    } else { setReportError(err.message || "Failed after retries."); setReportLoading(false); setReportRateLimitMsg(""); }
                });
        };
        connect();
    }, [selectedFile, reportLoading, reportQueryHint, reportTreeType, reportApproach, handleSingleSSEEvent, pushLog]);

    const generateMulti = useCallback(() => {
        const query = reportLocalQuery.trim();
        if (!query || reportLoading) return;
        let filenames = selectedFiles.length > 0
            ? selectedFiles
            : files.filter(f => f.status === "ready").map(f => f.name);
        filenames = Array.from(new Set(filenames));
        if (filenames.length === 0) { setReportError("No indexed documents found. Upload PDFs first."); return; }

        setReportLoading(true); setReportError(""); setReportLatex(""); setReportPdfUrl(null);
        setReportCompileError(""); setReportLiveLog([]);
        setReportActiveStep(-1); setReportRateLimitMsg("");
        setReportDocStatus(filenames.map(fn => ({ filename: fn, done: false, found: false })));
        setReportLeftTab("log");
        setReportQuery(query);

        const body = JSON.stringify({ filenames, query, report_title: reportTitle || query.slice(0, 60), tree_type: reportTreeType, search_approach: reportApproach });
        let retryCount = 0;
        const connect = () => {
            const accessToken = localStorage.getItem("access_token");
            const headers = { "Content-Type": "application/json" };
            if (accessToken) headers.Authorization = `Bearer ${accessToken}`;
            fetch(`${API}/generate-multi-report`, { method: "POST", headers, body })
                .then(res => {
                    if (!res.ok) return res.json().then(e => { throw new Error(e.error || `HTTP ${res.status}`); });
                    const reader = res.body.getReader(), dec = new TextDecoder();
                    let buf = "";
                    const pump = () => reader.read().then(({ done, value }) => {
                        if (done) { setReportLoading(p => { if (p) setReportError("Stream ended unexpectedly"); return false; }); return; }
                        buf += dec.decode(value, { stream: true });
                        const lines = buf.split("\n"); buf = lines.pop();
                        for (const line of lines) {
                            if (!line.startsWith("data: ")) continue;
                            try { const { type, ...rest } = JSON.parse(line.slice(6)); handleMultiSSEEvent(type, rest); } catch { continue; }
                        }
                        pump();
                    });
                    pump();
                })
                .catch(err => {
                    const is429 = err.message?.includes("429") || err.message?.toLowerCase().includes("rate");
                    if (retryCount < MAX_RETRIES) {
                        const delay = is429 ? RETRY_DELAYS[Math.min(retryCount, 2)] * 2 : RETRY_DELAYS[retryCount];
                        setReportRateLimitMsg(`Rate limited — retrying in ${delay / 1000}s…`); pushLog("⏳", `Retrying in ${delay / 1000}s`);
                        retryCount++; setTimeout(connect, delay);
                    } else { setReportError(err.message || "Failed after retries."); setReportLoading(false); setReportRateLimitMsg(""); }
                });
        };
        connect();
    }, [reportLocalQuery, reportLoading, selectedFiles, files, reportTitle, reportTreeType, reportApproach, handleMultiSSEEvent, pushLog, setReportQuery]);

    const cancelReport = useCallback(() => {
        setReportLoading(false); setReportRateLimitMsg(""); pushLog("✗", "Cancelled");
    }, [pushLog]);

    const compileToPdf = useCallback(async () => {
        if (!reportLatex || reportCompiling) return;
        setReportCompiling(true); setReportCompileError("");
        if (pdfUrlRef.current) { URL.revokeObjectURL(pdfUrlRef.current); pdfUrlRef.current = null; }
        setReportPdfUrl(null);
        try {
            const accessToken = localStorage.getItem("access_token");
            const headers = { "Content-Type": "application/json" };
            if (accessToken) headers.Authorization = `Bearer ${accessToken}`;
            const res = await fetch(`${API}/compile-latex`, { method: "POST", headers, body: JSON.stringify({ latex: reportLatex }) });
            if (!res.ok) { const e = await res.json().catch(() => ({})); throw new Error(e.error || `Compile failed: ${res.status}`); }
            const url = URL.createObjectURL(await res.blob());
            pdfUrlRef.current = url;
            setReportPdfUrl(url);
        } catch (e) {
            setReportCompileError(e.message || "Compilation failed");
        } finally {
            setReportCompiling(false);
        }
    }, [reportLatex, reportCompiling]);

    const replayReportEvents = useCallback((mode, events) => {
        setReportLiveLog([]);
        setReportSections([]);
        setReportDetectedMeta(null);
        setReportActiveStep(-1);
        setReportRateLimitMsg("");

        const handler = mode === "multi" ? handleMultiSSEEvent : handleSingleSSEEvent;
        for (const ev of events) {
            handler(ev.type, ev.data);
        }
    }, [handleSingleSSEEvent, handleMultiSSEEvent]);

    useEffect(() => {
        const accessToken = token || localStorage.getItem("access_token");
        if (!accessToken) return;

        let pollInterval = null;
        let isFetching = false;

        const checkActiveReport = async () => {
            if (isFetching) return;
            isFetching = true;
            try {
                const res = await axios.get(`${API}/active-report`, {
                    headers: { Authorization: `Bearer ${accessToken}` }
                });
                const active = res.data;
                if (active && active.status === "running") {
                    setReportLoading(true);
                    setReportMode(active.mode);
                    if (active.mode === "single") {
                        if (active.filename) {
                            fileContext?.setSelectedFile(active.filename);
                        }
                    } else {
                        setReportLocalQuery(active.query);
                        setReportQuery(active.query);
                    }
                    replayReportEvents(active.mode, active.events || []);

                    if (!pollInterval) {
                        pollInterval = setInterval(checkActiveReport, 2000);
                    }
                } else if (active && active.status === "completed") {
                    if (reportLoading) {
                        setReportLoading(false);
                        const lastRes = await axios.get(`${API}/last-report`, {
                            headers: { Authorization: `Bearer ${accessToken}` }
                        });
                        if (lastRes.data && lastRes.data.latex) {
                            setReportLatex(lastRes.data.latex);
                            if (lastRes.data.sections) {
                                setReportSections(lastRes.data.sections);
                            }
                            if (lastRes.data.doc_results) {
                                setReportDocResults(lastRes.data.doc_results);
                            }
                            if (lastRes.data.query) {
                                setReportQuery(lastRes.data.query);
                                setReportLocalQuery(lastRes.data.query);
                            }
                            setReportMode(lastRes.data.mode || "single");
                            if (lastRes.data.report_title) {
                                setReportTitle(lastRes.data.report_title);
                            }
                        }
                    }
                    if (pollInterval) {
                        clearInterval(pollInterval);
                        pollInterval = null;
                    }
                } else if (active && active.status === "failed") {
                    setReportActiveStep(-1);
                    if (reportLoading) {
                        setReportLoading(false);
                        setReportError(active.error || "Report generation failed.");
                    }
                    if (pollInterval) {
                        clearInterval(pollInterval);
                        pollInterval = null;
                    }
                } else {
                    if (reportLoading) {
                        setReportLoading(false);
                    }
                    if (pollInterval) {
                        clearInterval(pollInterval);
                        pollInterval = null;
                    }
                }
            } catch (err) {
                console.error("[REPORT-PROVIDER] Failed to fetch active report status:", err);
            } finally {
                isFetching = false;
            }
        };

        checkActiveReport();

        if (reportLoading && !pollInterval) {
            pollInterval = setInterval(checkActiveReport, 2000);
        }

        return () => {
            if (pollInterval) {
                clearInterval(pollInterval);
            }
        };
    }, [token, reportLoading, replayReportEvents]);

    useEffect(() => {
        return () => {
            if (pdfUrlRef.current) {
                URL.revokeObjectURL(pdfUrlRef.current);
            }
        };
    }, []);
    const reportContextValue = React.useMemo(() => ({
        // Persistent UI States
        reportLiveLog, setReportLiveLog, pushLog,
        reportSections, setReportSections,
        reportActiveStep, setReportActiveStep,
        reportDocStatus, setReportDocStatus,
        reportLeftTab, setReportLeftTab,
        
        // Persistent Generation States
        reportLatex, setReportLatex,
        reportQuery, setReportQuery,
        reportLocalQuery, setReportLocalQuery,
        reportTitle, setReportTitle,
        reportMode, setReportMode,
        reportQueryHint, setReportQueryHint, persistHint,
        reportTreeType, setReportTreeType,
        reportApproach, setReportApproach,

        // In-Memory States
        reportLoading, setReportLoading,
        reportError, setReportError,
        reportRateLimitMsg, setReportRateLimitMsg,
        reportPdfUrl, setReportPdfUrl,
        reportCompiling, setReportCompiling,
        reportCompileError, setReportCompileError,

        // Action functions
        generateSingle, generateMulti, cancelReport, compileToPdf
    }), [
        reportLiveLog, reportSections, reportActiveStep, reportDocStatus, reportLeftTab,
        reportLatex, reportQuery, reportLocalQuery, reportTitle, reportMode, reportQueryHint, reportTreeType, reportApproach,
        reportLoading, reportError, reportRateLimitMsg, reportPdfUrl, reportCompiling, reportCompileError,
        pushLog, persistHint, generateSingle, generateMulti, cancelReport, compileToPdf
    ]);

    return (
        <ReportContext.Provider value={reportContextValue}>
            {children}
        </ReportContext.Provider>
    );
}

// Nested AppProvider Wrapper
export function AppProvider({ children }) {
    const { loading, user } = useAuth();
    if (loading) return null;
    return (
        <SidebarProvider key={user?.id || 'guest'}>
            <FileProvider>
                <ChatProvider>
                    <ReportProvider>
                        {children}
                    </ReportProvider>
                </ChatProvider>
            </FileProvider>
        </SidebarProvider>
    );
}
