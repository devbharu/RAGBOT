/**
 * AppContext.jsx — Central state management for CMTI Bot
 * Manages: files, selectedFile, upload state, messages across Chatbot + ReportPanel
 */

import { createContext, useContext, useState, useCallback, useEffect, useRef } from "react";
import axios from "axios";

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
    // ── File state ──────────────────────────────────────────────
    const [files, setFiles] = useState([]);
    const [selectedFile, setSelectedFile] = useState("");
    const [uploading, setUploading] = useState(false);
    const [uploadProgress, setUploadProgress] = useState("Uploading…");

    // ── Chat messages ───────────────────────────────────────────
    const [messages, setMessages] = useState([
        {
            id: 1,
            type: "bot",
            content: "Upload a PDF or TXT and start querying.",
            timestamp: new Date(),
        },
    ]);

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
    const handleReindex = useCallback(
        async (filename) => {
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
        },
        []
    );

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
                alert(
                    `Failed to delete file: ${err.response?.data?.error || err.message}`
                );
            }
        },
        [selectedFile]
    );

    // ── Reset chat ──────────────────────────────────────────────
    const resetChat = useCallback(() => {
        setMessages([
            {
                id: 1,
                type: "bot",
                content: "Upload a PDF or TXT and start querying.",
                timestamp: new Date(),
            },
        ]);
    }, []);

    const value = {
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

        // Messages
        messages,
        setMessages,
        resetChat,

        // Report
        reportLatex,
        setReportLatex,
        reportSections,
        setReportSections,

        // API base
        API,
    };

    return <AppContext.Provider value={value}>{children}</AppContext.Provider>;
}