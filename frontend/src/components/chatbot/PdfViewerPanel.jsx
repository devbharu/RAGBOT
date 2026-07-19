import React, { useState } from "react";
import { X, FileSearch, Upload, Loader2, Share2 } from "lucide-react";
import { useFileStore } from "../../context/AppContext";

export const PdfViewerPanel = ({ filename, pdfPage, onClose }) => {
    const { getFileUrl } = useFileStore();
    const [fileError, setFileError] = useState(false);
    const [loading, setLoading] = useState(true);
    const nameLower = filename?.toLowerCase() || "";
    const isPdf = nameLower.endsWith(".pdf") || nameLower.endsWith("_pdf") || nameLower.includes("pdf");
    const isTxt = nameLower.endsWith(".txt") || nameLower.endsWith("_txt") || nameLower.includes("txt");
    const isSupported = isPdf || isTxt;
    let fileUrl = isSupported ? getFileUrl(filename) : null;
    if (fileUrl && isPdf && pdfPage) {
        fileUrl += `#page=${pdfPage}`;
    }
    return (
        <div className="flex flex-col h-full bg-[var(--bg-base)] overflow-hidden">
            <div className="flex items-center justify-between px-4 py-3 flex-shrink-0 border-b border-[var(--border-mid)]" style={{ backgroundColor: "var(--bg-panel)" }}>
                <div className="flex items-center gap-2.5 flex-1 min-w-0">
                    <div className="w-8 h-8 rounded-lg bg-[var(--accent-dim)] flex items-center justify-center flex-shrink-0"><FileSearch size={14} className="text-[var(--accent)]" /></div>
                    <div className="flex-1 min-w-0">
                        <p className="text-[9px] text-[var(--text-faint)] font-mono tracking-widest uppercase mb-0.5">Document</p>
                        <p className="text-xs text-[var(--text-primary)] font-medium truncate" title={filename}>{filename || "No file"}</p>
                    </div>
                </div>
                <div className="flex items-center gap-1.5 flex-shrink-0">
                    {fileUrl && <a href={fileUrl} download className="p-1.5 rounded-md bg-transparent border border-[var(--border)] cursor-pointer text-[var(--text-muted)] hover:text-[var(--accent)] transition-all"><Upload size={13} /></a>}
                    <button onClick={onClose} className="p-1.5 rounded-md bg-transparent border border-[var(--border)] cursor-pointer text-[var(--text-faint)] hover:text-[var(--text-primary)] transition-all"><X size={13} /></button>
                </div>
            </div>
            <div className="flex-1 overflow-hidden relative bg-white flex flex-col">
                {loading && fileUrl && !fileError && <div className="absolute inset-0 flex flex-col items-center justify-center bg-white z-20"><Loader2 size={28} className="text-[var(--accent)] animate-spin mb-2" /><p className="text-sm text-[var(--text-faint)] font-mono">Loading…</p></div>}
                {fileUrl && !fileError && <iframe key={fileUrl} src={fileUrl} title="File Viewer" className="w-full h-full border-none flex-1 bg-white" onLoad={() => setLoading(false)} onError={() => { setLoading(false); setFileError(true); }} allow="fullscreen" />}
                {(!fileUrl || fileError) && (
                    <div className="flex-1 flex flex-col items-center justify-center gap-4 px-8 py-12">
                        <FileSearch size={32} className="text-[var(--accent)] opacity-50" />
                        <p className="text-sm text-[var(--text-faint)]">{fileError ? "Couldn't load this file." : "Select a PDF or TXT to preview."}</p>
                        {fileError && fileUrl && <a href={fileUrl} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-2 px-4 py-2 bg-[var(--accent)] text-[var(--on-accent)] text-xs font-semibold rounded-lg hover:opacity-90 transition-all"><Share2 size={12} /> Open in New Tab</a>}
                    </div>
                )}
            </div>
        </div>
    );
};
