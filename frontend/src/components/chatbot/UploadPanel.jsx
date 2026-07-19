import React, { useRef, useState, useCallback } from "react";
import { X, Loader2, FileUp, FileText, CheckCircle, Clock, RefreshCw } from "lucide-react";
import { useFileStore } from "../../context/AppContext";

const UploadZone = ({ onUpload, uploading, uploadProgress }) => {
    const [dragging, setDragging] = useState(false);
    const inputRef = useRef(null);
    const handleDrop = useCallback((e) => {
        e.preventDefault(); setDragging(false);
        const droppedFiles = Array.from(e.dataTransfer.files);
        droppedFiles.forEach(file => onUpload(file));
    }, [onUpload]);
    return (
        <div onDrop={handleDrop} onDragOver={e => { e.preventDefault(); setDragging(true); }} onDragLeave={() => setDragging(false)}
            onClick={() => !uploading && inputRef.current?.click()}
            className={`relative flex flex-col items-center justify-center gap-3 rounded-xl p-8 transition-all duration-200 cursor-pointer border border-dashed ${dragging ? "border-[var(--accent)] bg-[var(--accent-dim)]" : "border-[var(--border-mid)] bg-[var(--bg-base)]"} ${uploading ? "opacity-70 pointer-events-none" : ""}`}>
            <input ref={inputRef} type="file" accept=".pdf,.txt" multiple onChange={e => { 
                const selected = Array.from(e.target.files);
                selected.forEach(f => onUpload(f));
                e.target.value = ""; 
            }} className="hidden" />
            <div className={`w-11 h-11 rounded-xl flex items-center justify-center border transition-all ${dragging ? "bg-[var(--accent-dim)] border-[var(--accent)]" : "bg-[var(--bg-elevated)] border-[var(--border-mid)]"}`}>
                {uploading ? <Loader2 size={18} className="text-[var(--accent)] animate-spin" /> : <FileUp size={18} className={dragging ? "text-[var(--accent)]" : "text-[var(--text-faint)]"} />}
            </div>
            <div className="text-center">
                <p className="text-sm text-[var(--text-primary)] font-mono m-0">{uploading ? uploadProgress : dragging ? "Drop to upload" : "Drop file here"}</p>
                <p className="text-xs text-[var(--text-faint)] mt-1 font-mono">{uploading ? "Processing…" : "click to browse · PDF & TXT"}</p>
            </div>
        </div>
    );
};

export const UploadPanel = ({ onClose }) => {
    const { handleUploadFile, uploading, uploadProgress, files, selectedFile, setSelectedFile, handleReindex } = useFileStore();
    return (
        <div className="fixed inset-0 z-[200] flex items-center justify-center backdrop-blur-sm" style={{ background: "var(--overlay-bg)" }} onClick={() => !uploading && onClose()}>
            <div className="relative w-full max-w-3xl mx-4 bg-[var(--bg-panel)] border border-[var(--border-mid)] rounded-2xl p-6 flex flex-col gap-5 shadow-2xl" onClick={e => e.stopPropagation()}>
                <div className="flex items-start justify-between">
                    <div>
                        <h2 className="text-sm font-medium text-[var(--text-primary)] m-0" style={{ fontFamily: "'Fraunces', serif", fontStyle: "italic" }}>Upload Document</h2>
                        <p className="text-[10px] text-[var(--text-faint)] mt-1 tracking-widest uppercase font-mono">PDF or TXT · indexed automatically</p>
                    </div>
                    {!uploading && <button onClick={onClose} className="p-1.5 rounded-lg bg-transparent border border-[var(--border-mid)] cursor-pointer text-[var(--text-muted)] flex items-center justify-center transition-all hover:bg-[var(--bg-elevated)] hover:text-[var(--text-primary)]"><X size={13} /></button>}
                </div>
                <UploadZone onUpload={handleUploadFile} uploading={uploading} uploadProgress={uploadProgress} />
                {!uploading && files.length > 0 && (
                    <div>
                        <p className="text-[10px] text-[var(--text-faint)] tracking-widest uppercase mb-2 font-mono">Indexed documents</p>
                        <div className="flex flex-col gap-0.5 max-h-48 overflow-y-auto">
                            {files.map(f => (
                                <div key={f.name} className={`flex items-center gap-2 px-2.5 py-1.5 rounded-lg border transition-all ${selectedFile === f.name ? "bg-[var(--accent-dim)] border-[var(--accent)]/30" : "border-transparent"}`}>
                                    <button onClick={() => { setSelectedFile(f.name); onClose(); }} className={`flex items-center gap-2 flex-1 text-left bg-transparent border-none cursor-pointer text-xs font-mono ${selectedFile === f.name ? "text-[var(--accent)]" : "text-[var(--text-muted)]"}`}>
                                        <FileText size={11} className="flex-shrink-0" />
                                        <span className="flex-1 overflow-hidden text-ellipsis whitespace-nowrap">{f.name}</span>
                                        {f.status === "indexing" && <span className="text-[10px] text-[var(--accent)]/60 flex items-center gap-1"><Clock size={9} />indexing</span>}
                                        {f.status === "ready" && selectedFile === f.name && <CheckCircle size={11} className="text-[var(--accent)]" />}
                                    </button>
                                    <button onClick={e => { e.stopPropagation(); handleReindex(f.name); }} title="Re-index" className="p-1 rounded bg-transparent border-none cursor-pointer text-[var(--text-faint)] hover:text-[var(--text-muted)] hover:bg-[var(--bg-elevated)] transition-all"><RefreshCw size={10} /></button>
                                </div>
                            ))}
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
};
