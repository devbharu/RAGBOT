/**
 * AppContext.jsx — Central state management for CMTI Bot
 */

/* eslint-disable react-refresh/only-export-components */

import { createContext, useContext, useState, useCallback, useEffect, useRef } from "react";
import axios from "axios";
import { useAuth } from "./AuthContext";

export const API = "http://127.0.0.1:8080";

// ─── Context ───────────────────────────────────────────────────
const AppContext = createContext(null);

export const useApp = () => {
    const ctx = useContext(AppContext);
    if (!ctx) throw new Error("useApp must be used within AppProvider");
    return ctx;
};

// ─── Provider ──────────────────────────────────────────────────
export function AppProvider({ children }) {
    const { isAuthenticated, loading: authLoading } = useAuth();

    // ── Sidebar state ───────────────────────────────────────────
    const [sidebarOpen, setSidebarOpen] = useState(true);

    // ── Chat state (backend persistent) ─────────────────────────
    const [chats, setChats] = useState([]);
    const [currentChatId, setCurrentChatId] = useState(null);
    const [messages, setMessages] = useState([]);

    // ── File state ──────────────────────────────────────────────
    const [files, setFiles] = useState([]);
    const [selectedFile, setSelectedFile] = useState("");
    const [uploading, setUploading] = useState(false);
    const [uploadProgress, setUploadProgress] = useState("Uploading…");

    // ── Report state ────────────────────────────────────────────
    const [reportLatex, setReportLatex] = useState("");
    const [reportSections, setReportSections] = useState([]);

    // ── Polling for indexing files ──────────────────────────────
    const pollingRef = useRef(null);

    const fetchFiles = useCallback(async () => {
        try {
            const res = await axios.get(`${API}/files`);
            const raw = res.data.files || [];
            const list = raw.map((f) =>
                typeof f === "string"
                    ? { name: f, status: "ready" }
                    : { name: f.name, status: f.status || "ready" }
            );
            setFiles(list);
            if (list.length > 0)
                setSelectedFile((prev) => prev || list[0].name);
        } catch (e) {
            console.error("Failed to fetch files:", e);
        }
    }, []);

    useEffect(() => {
        fetchFiles();
    }, [fetchFiles]);

    const fetchChats = useCallback(async () => {
        try {
            const res = await axios.get(`${API}/chats`);
            const chatList = res.data?.chats || [];
            setChats(chatList);
            return chatList;
        } catch (e) {
            console.error("Failed to fetch chats:", e);
            return null;
        }
    }, []);

    const loadChat = useCallback(async (chatId) => {
        if (!chatId) {
            setCurrentChatId(null);
            setMessages([]);
            return;
        }
        try {
            const res = await axios.get(`${API}/chat/${chatId}`);
            const incoming = (res.data?.messages || []).map((m) => ({
                id: m.id,
                type: m.role === "assistant" ? "bot" : "user",
                content: m.content,
                timestamp: m.timestamp ? new Date(m.timestamp) : new Date(),
            }));
            setCurrentChatId(chatId);
            setMessages(incoming);
            localStorage.setItem("currentChatId", String(chatId));
        } catch (e) {
            console.error("Failed to load chat:", e);
        }
    }, []);

    const createChat = useCallback(async (title = "New Chat") => {
        const res = await axios.post(`${API}/chat`, { title });
        const chat = res.data?.chat;
        if (!chat) return null;
        setChats((prev) => [chat, ...prev]);
        setCurrentChatId(chat.id);
        localStorage.setItem("currentChatId", String(chat.id));
        return chat.id;
    }, []);

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
                    localStorage.removeItem("currentChatId");
                }
            }
        } catch (e) {
            console.error("Failed to delete chat:", e);
            throw e;
        }
    }, [chats, currentChatId, loadChat]);

    useEffect(() => {
        if (authLoading) return;

        const bootstrap = async () => {
            if (!isAuthenticated) {
                setChats([]);
                setCurrentChatId(null);
                setMessages([]);
                localStorage.removeItem("currentChatId");
                return;
            }

            const list = await fetchChats();
            if (list === null) {
                return;
            }
            if (list.length === 0) {
                setCurrentChatId(null);
                setMessages([]);
                localStorage.removeItem("currentChatId");
                return;
            }

            const storedRaw = localStorage.getItem("currentChatId");
            const storedId = storedRaw ? Number(storedRaw) : null;
            const chatToLoad = list.find((c) => c.id === storedId)?.id || list[0].id;
            await loadChat(chatToLoad);
        };

        bootstrap();
    }, [authLoading, isAuthenticated, fetchChats, loadChat]);

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
                        const res = await axios.get(
                            `${API}/status/${encodeURIComponent(f.name)}`
                        );
                        if (res.data.status !== f.status) changed = true;
                        return { ...f, status: res.data.status };
                    } catch {
                        return f;
                    }
                })
            );
            if (changed) setFiles(updated);
        }, 3000);

        return () => clearInterval(pollingRef.current);
    }, [files]);

    // ── Upload ──────────────────────────────────────────────────
    const handleUploadFile = useCallback(
        async (file) => {
            if (!file) return;
            const ext = "." + file.name.split(".").pop().toLowerCase();
            if (![".pdf", ".txt"].includes(ext)) {
                alert("Only PDF and TXT files are supported.");
                return;
            }
            setUploading(true);
            setUploadProgress("Uploading file…");
            const formData = new FormData();
            formData.append("file", file);
            try {
                const progressTimer = setTimeout(
                    () => setUploadProgress("Indexing document…"),
                    1500
                );
                const res = await axios.post(`${API}/upload`, formData, {
                    headers: { "Content-Type": "multipart/form-data" },
                });
                clearTimeout(progressTimer);
                const uploaded = res.data.file;
                await fetchFiles();
                setSelectedFile(uploaded);
                setMessages((prev) => [
                    ...prev,
                    {
                        id: Date.now(),
                        type: "bot",
                        content: `**"${uploaded}"** uploaded and indexed. You can now query it.`,
                        timestamp: new Date(),
                    },
                ]);
            } catch (err) {
                setMessages((prev) => [
                    ...prev,
                    {
                        id: Date.now(),
                        type: "bot",
                        content: `Upload failed: ${err.response?.data?.error || err.message}`,
                        timestamp: new Date(),
                    },
                ]);
            } finally {
                setUploading(false);
                setUploadProgress("Uploading…");
            }
        },
        [fetchFiles]
    );

    // ── Reindex ─────────────────────────────────────────────────
    const handleReindex = useCallback(async (filename) => {
        try {
            await axios.post(`${API}/reindex`, { filename });
            setFiles((prev) =>
                prev.map((f) =>
                    f.name === filename ? { ...f, status: "indexing" } : f
                )
            );
            setMessages((prev) => [
                ...prev,
                {
                    id: Date.now(),
                    type: "bot",
                    content: `Re-indexing **"${filename}"** started.`,
                    timestamp: new Date(),
                },
            ]);
        } catch (err) {
            setMessages((prev) => [
                ...prev,
                {
                    id: Date.now(),
                    type: "bot",
                    content: `Re-index failed: ${err.response?.data?.error || err.message}`,
                    timestamp: new Date(),
                },
            ]);
        }
    }, []);

    // ── Delete ──────────────────────────────────────────────────
    const handleDeleteFile = useCallback(
        async (filename) => {
            if (
                !window.confirm(
                    `Permanently delete "${filename}"? This removes the index and file.`
                )
            )
                return;
            try {
                const res = await axios.post(`${API}/delete`, { filename });
                if (res.data.status === "deleted" || res.data.status === "success") {
                    setFiles((prev) => {
                        const remaining = prev.filter((f) => f.name !== filename);
                        if (selectedFile === filename)
                            setSelectedFile(remaining[0]?.name || "");
                        return remaining;
                    });
                    setMessages((prev) => [
                        ...prev,
                        {
                            id: Date.now(),
                            type: "bot",
                            content: `**"${filename}"** has been permanently deleted.`,
                            timestamp: new Date(),
                        },
                    ]);
                }
            } catch (err) {
                alert(`Failed to delete file: ${err.response?.data?.error || err.message}`);
            }
        },
        [selectedFile]
    );

    // ── Reset chat ──────────────────────────────────────────────
    const resetChat = useCallback(() => {
        setMessages([]);
    }, []);

    // ── Chat management ─────────────────────────────────────────
    const startNewChat = useCallback(async () => {
        await createChat("New Chat");
        setMessages([]);
        setSidebarOpen(false);
    }, [createChat]);

    const addChatToHistory = useCallback(async (title) => {
        if (!title || title.trim() === "") return null;
        return createChat(title.substring(0, 80));
    }, [createChat]);

    const setActiveChat = useCallback((chatId) => {
        setCurrentChatId(chatId || null);
        if (!chatId) {
            localStorage.removeItem("currentChatId");
        } else {
            localStorage.setItem("currentChatId", String(chatId));
        }
    }, []);

    // ── PDF URL helper ──────────────────────────────────────────
    // Constructs the URL to serve a file from the Flask /file/<path:filename> endpoint.
    // Flask's <path:filename> route accepts raw slashes/spaces — we only encode
    // special chars that would break the URL (using encodeURIComponent per segment
    // but NOT encoding slashes, since Flask path: handles them).
    // Files like "04 - Heat Treating.pdf" live in UPLOAD_DIR on the server.
    const getFileUrl = useCallback((filename) => {
        if (!filename) return null;
        // Split on "/" to preserve path separators, encode each segment individually
        const encoded = filename
            .split("/")
            .map((seg) => encodeURIComponent(seg))
            .join("/");
        return `${API}/file/${encoded}`;
    }, []);

    // ─── Context value ──────────────────────────────────────────
    const value = {
        // Sidebar
        sidebarOpen,
        setSidebarOpen,

        // Chats
        chats,
        setChats,
        currentChatId,
        setCurrentChatId,
        fetchChats,
        createChat,
        
        // Sidebar compatibility aliases
        chatHistory: chats,
        activeChat: currentChatId,
        setActiveChat,
        startNewChat,
        addChatToHistory,
        loadChat,
        deleteChat,

        // Files
        files,
        setFiles,
        selectedFile,
        setSelectedFile,
        uploading,
        uploadProgress,
        fetchFiles,
        handleUploadFile,
        handleReindex,
        handleDeleteFile,
        getFileUrl,         // ← PDF URL builder for iframe src

        // Messages
        messages,
        setMessages,
        resetChat,

        // Report
        reportLatex,
        setReportLatex,
        reportSections,
        setReportSections,

        // API base (convenience re-export)
        API,
    };

    return <AppContext.Provider value={value}>{children}</AppContext.Provider>;
}