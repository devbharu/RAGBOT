import React, { useState, useEffect } from 'react';
import axios from 'axios';
import { X, Database, Network, Search, Loader2, CheckCircle, XCircle, ArrowLeft, PlayCircle, ChevronRight, ChevronDown, FileText } from 'lucide-react';
import { API } from '../../context/AppContext';

const TreeNode = ({ node, depth = 0 }) => {
    const [open, setOpen] = useState(depth < 1);
    if (!node) return null;
    const hasChildren = node.nodes && node.nodes.length > 0;
    const title = node.title || node.document_name || "Untitled";
    const id = node.node_id || node.id || "";
    const summary = node.summary || node.description || "";
    
    return (
        <div className="flex flex-col w-full text-[13px]">
            <div className={`flex items-start py-[5px] transition-colors ${depth === 0 ? "mb-1.5" : ""}`}>
                {/* Indent Spacer */}
                <div style={{ width: depth * 18 }} className="flex-shrink-0" />
                
                {/* Expand Toggle */}
                <div className="flex items-center justify-center w-5 h-5 mr-1.5 flex-shrink-0 mt-[1px]">
                    {hasChildren ? (
                        <button onClick={() => setOpen(!open)} className="text-[var(--text-faint)] hover:text-[var(--text-primary)] cursor-pointer bg-transparent border-none p-0 transition-colors flex items-center justify-center">
                            {open ? <ChevronDown size={14} strokeWidth={2} /> : <ChevronRight size={14} strokeWidth={2} />}
                        </button>
                    ) : (
                        <FileText size={13} className="text-[var(--text-faint)] opacity-70" strokeWidth={1.5} />
                    )}
                </div>
                
                {/* Content */}
                <div className="flex flex-col flex-1 min-w-0">
                    <div className="flex items-center flex-wrap gap-1.5">
                        <span className={`font-medium tracking-wide truncate ${depth === 0 ? "text-[var(--text-primary)]" : "text-[var(--text-body)]"}`}>
                            {title}
                        </span>
                        {id && (
                            <span className="text-[10px] text-[var(--text-faint)] font-mono ml-0.5">
                                {id}
                            </span>
                        )}
                        {(node.start_page || node.end_page) && (
                            <span className="text-[10px] text-[var(--accent)] font-mono ml-0.5 opacity-90">
                                {node.start_page === node.end_page ? `p.${node.start_page}` : `p.${node.start_page}-${node.end_page}`}
                            </span>
                        )}
                    </div>
                    {summary && (
                        <p className="text-[12px] text-[var(--text-muted)] leading-relaxed mt-0.5 pr-4">
                            {summary}
                        </p>
                    )}
                </div>
            </div>
            
            {/* Children Container */}
            {open && hasChildren && (
                <div className="flex flex-col relative">
                    <div className="absolute top-1 bottom-2 w-[1px] bg-[var(--border)]" style={{ left: (depth * 18) + 9.5 }} />
                    {node.nodes.map((child, i) => <TreeNode key={i} node={child} depth={depth + 1} />)}
                </div>
            )}
        </div>
    );
};

export const IndexAnalyticsModal = ({ onClose }) => {
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);
    const [analyticsData, setAnalyticsData] = useState([]);
    const [viewingTree, setViewingTree] = useState(null); // { filename, type, data, loading, error }
    const [building, setBuilding] = useState({}); // { [filename]: boolean }

    const fetchAnalytics = async () => {
        try {
            const res = await axios.get(`${API}/api/analytics/index`);
            setAnalyticsData(res.data.data || []);
            setLoading(false);
        } catch (err) {
            setError(err.message);
            setLoading(false);
        }
    };

    useEffect(() => {
        fetchAnalytics();
    }, []);

    const fetchTree = async (filename, type) => {
        setViewingTree({ filename, type, data: null, loading: true, error: null });
        try {
            const res = await axios.get(`${API}/pageindex/tree/${encodeURIComponent(filename)}?type=${type}`);
            setViewingTree({ filename, type, data: res.data, loading: false, error: null });
        } catch (err) {
            setViewingTree({ filename, type, data: null, loading: false, error: err.response?.data?.error || err.message });
        }
    };

    const handleBuildPremium = async (filename) => {
        try {
            await axios.post(`${API}/pageindex/build`, { filename });
            fetchAnalytics(); // instantly fetch the new "building" status
        } catch (err) {
            alert(`Error building premium tree: ${err.response?.data?.error || err.message}`);
        }
    };

    // Auto-poll if any document is currently building
    useEffect(() => {
        let interval;
        const isBuilding = analyticsData.some(doc => doc.build_status && doc.build_status.status === "building" || doc.build_status?.status === "optimizing");
        if (isBuilding) {
            interval = setInterval(() => {
                fetchAnalytics();
            }, 3000);
        }
        return () => clearInterval(interval);
    }, [analyticsData]);

    const StatusBadge = ({ active, label, icon: Icon, colorClass, onClick, interactive }) => (
        <button 
            onClick={active && interactive ? onClick : undefined}
            className={`flex items-center gap-1.5 px-2 py-1 rounded-md text-[10px] font-mono font-semibold border transition-all ${active ? colorClass : 'bg-[var(--bg-elevated)] border-[var(--border-mid)] text-[var(--text-faint)]'} ${active && interactive ? 'cursor-pointer hover:opacity-80' : 'cursor-default'}`}>
            {Icon && <Icon size={12} />}
            {label}
            {active ? <CheckCircle size={10} className="ml-1" /> : <XCircle size={10} className="ml-1 opacity-50" />}
        </button>
    );

    return (
        <div className="fixed inset-0 z-[300] flex items-center justify-center backdrop-blur-sm animate-[fadeIn_0.15s_ease]" style={{ background: "var(--overlay-bg)" }} onClick={onClose}>
            <div className={`relative overflow-hidden w-full mx-4 bg-[var(--bg-panel)] border border-[var(--border-mid)] rounded-2xl flex flex-col shadow-2xl animate-[fadeSlideUp_0.2s_ease] max-h-[85vh] transition-all duration-300 ${viewingTree ? 'max-w-6xl' : 'max-w-4xl'}`} onClick={e => e.stopPropagation()}>
                
                {/* Header */}
                <div className="flex items-center justify-between p-5 border-b border-[var(--border)] shrink-0 bg-[var(--bg-panel)] z-10">
                    <div className="flex items-center gap-3 text-[var(--text-primary)]">
                        {viewingTree ? (
                            <button onClick={() => setViewingTree(null)} className="p-2 bg-[var(--bg-elevated)] text-[var(--text-muted)] rounded-lg hover:text-[var(--accent)] cursor-pointer border-none transition-colors">
                                <ArrowLeft size={18} />
                            </button>
                        ) : (
                            <div className="p-2 bg-[var(--accent-dim)] text-[var(--accent)] rounded-lg">
                                <Database size={18} />
                            </div>
                        )}
                        <div>
                            <h2 className="text-sm font-medium m-0" style={{ fontFamily: "'Fraunces', serif" }}>
                                {viewingTree ? `Tree Visualizer: ${viewingTree.filename}` : "Tree and Vector Analytics"}
                            </h2>
                            <p className="text-[10px] text-[var(--text-faint)] mt-0.5 tracking-widest uppercase font-mono">
                                {viewingTree ? `${viewingTree.type} Tree` : "Document Index Statuses"}
                            </p>
                        </div>
                    </div>
                    <button onClick={onClose} className="p-1.5 rounded-lg bg-transparent border border-[var(--border-mid)] cursor-pointer text-[var(--text-muted)] flex items-center justify-center transition-all hover:bg-[var(--bg-elevated)] hover:text-[var(--text-primary)]">
                        <X size={14} />
                    </button>
                </div>

                {/* Body - Split Layout */}
                <div className="flex overflow-hidden relative" style={{ backgroundColor: "var(--bg-surface)", height: "65vh" }}>
                    
                    {/* Left List Pane */}
                    <div className={`overflow-y-auto shrink-0 transition-all duration-300 ${viewingTree ? 'w-2/5 border-r border-[var(--border)]' : 'w-full'}`}>
                        <div className="p-5 flex flex-col gap-2">
                            {loading ? (
                                <div className="flex flex-col items-center justify-center py-12 gap-3 text-[var(--text-muted)]">
                                    <Loader2 size={24} className="animate-spin text-[var(--accent)]" />
                                    <span className="text-xs font-mono">Fetching index statistics...</span>
                                </div>
                            ) : error ? (
                                <div className="p-4 bg-[var(--red-soft)] text-[var(--red)] rounded-xl text-xs font-mono">
                                    Error: {error}
                                </div>
                            ) : analyticsData.length === 0 ? (
                                <div className="text-center py-8 text-xs text-[var(--text-faint)] font-mono">
                                    No documents found in the database.
                                </div>
                            ) : (
                                analyticsData.map(doc => {
                                    const isSelected = viewingTree?.filename === doc.filename;
                                    return (
                                        <div key={doc.filename} className={`flex items-center justify-between border p-3 rounded-xl transition-colors group ${isSelected ? 'bg-[var(--accent-dim)] border-[var(--accent)]/50' : 'bg-[var(--bg-panel)] border-[var(--border-mid)] hover:border-[var(--accent)]/40'}`}>
                                            <div className="flex flex-col gap-1 overflow-hidden pr-2">
                                                <span className={`text-xs font-medium truncate font-mono ${isSelected ? 'text-[var(--accent)]' : 'text-[var(--text-primary)]'}`}>{doc.filename}</span>
                                                <span className="text-[9px] text-[var(--text-faint)] font-mono uppercase tracking-wider">
                                                    {(doc.size_bytes / 1024).toFixed(1)} KB
                                                </span>
                                            </div>
                                            
                                            <div className={`flex items-center gap-2 shrink-0 ${viewingTree ? 'flex-col items-end' : 'ml-4'}`}>
                                                {!viewingTree && (
                                                    <StatusBadge 
                                                        active={doc.has_vector} 
                                                        label="Vector" 
                                                        icon={Search} 
                                                        colorClass="bg-[var(--accent-dim)] border-[var(--accent)]/30 text-[var(--accent)]"
                                                    />
                                                )}

                                                {doc.has_premium ? (
                                                    <StatusBadge 
                                                        active={true} 
                                                        label={viewingTree ? "Prem" : "Premium Tree"} 
                                                        icon={Network} 
                                                        colorClass={viewingTree?.type === 'tree' && isSelected ? "bg-[#eab308] text-white border-transparent" : "bg-[#eab308]/10 border-[#eab308]/30 text-[#eab308]"}
                                                        interactive={true}
                                                        onClick={() => fetchTree(doc.filename, 'tree')}
                                                    />
                                                ) : doc.build_status && (doc.build_status.status === "building" || doc.build_status.status === "optimizing") ? (
                                                    <button 
                                                        disabled
                                                        className="flex items-center gap-1.5 px-2 py-1 rounded-md text-[10px] font-mono font-semibold border bg-[var(--bg-elevated)] border-[var(--border-mid)] text-[var(--text-faint)]">
                                                        <Loader2 size={12} className="animate-spin" />
                                                        {!viewingTree && (doc.build_status.status === "optimizing" ? "Optimizing..." : "Building...")}
                                                        <span className="ml-1 opacity-70">{(doc.build_status.progress * 100).toFixed(0)}%</span>
                                                    </button>
                                                ) : (
                                                    <button 
                                                        onClick={() => handleBuildPremium(doc.filename)}
                                                        className="flex items-center gap-1.5 px-2 py-1 rounded-md text-[10px] font-mono font-semibold border transition-all cursor-pointer bg-transparent border-[#eab308]/40 text-[#eab308] hover:bg-[#eab308]/10">
                                                        <PlayCircle size={12} />
                                                        {!viewingTree && "Build Premium Tree"}
                                                    </button>
                                                )}
                                            </div>
                                        </div>
                                    );
                                })
                            )}
                        </div>
                    </div>

                    {/* Right Tree Pane */}
                    {viewingTree && (
                        <div className="w-3/5 flex flex-col bg-[var(--bg-panel)] border-l border-[var(--border)] overflow-hidden">
                            <div className="flex-1 overflow-y-auto p-6 shadow-inner font-mono text-[11.5px] leading-relaxed">
                                {(() => {
                                    const doc = analyticsData.find(d => d.filename === viewingTree.filename);
                                    const isBuilding = doc?.build_status && (doc.build_status.status === "building" || doc.build_status.status === "optimizing");
                                    const isWaitingForBuild = isBuilding && viewingTree.type === 'tree';

                                    if (viewingTree.loading) {
                                        return (
                                            <div className="flex flex-col items-center justify-center h-full gap-3 text-[var(--text-muted)]">
                                                <Loader2 size={24} className="animate-spin text-[var(--accent)]" />
                                                <span className="text-xs font-mono">Loading tree structure...</span>
                                            </div>
                                        );
                                    }
                                    
                                    if (isWaitingForBuild || (viewingTree.error && isBuilding)) {
                                        return (
                                            <div className="flex flex-col items-center justify-center h-full gap-3 text-[var(--text-muted)] opacity-80">
                                                <Loader2 size={28} className="animate-spin text-[var(--accent)]" />
                                                <span className="text-xs font-mono font-semibold text-[var(--text-primary)]">
                                                    {doc.build_status.status === "optimizing" ? "Optimizing Tree..." : "Building Agentic Tree..."}
                                                </span>
                                                <span className="text-[10px] uppercase tracking-wider opacity-70">
                                                    {(doc.build_status.progress * 100).toFixed(0)}% Complete
                                                </span>
                                            </div>
                                        );
                                    }

                                    if (viewingTree.error) {
                                        return (
                                            <div className="p-4 bg-[var(--red-soft)] text-[var(--red)] rounded-xl text-xs font-mono">
                                                Error: {viewingTree.error}
                                            </div>
                                        );
                                    }

                                    if (viewingTree.data && (!viewingTree.data.nodes || viewingTree.data.nodes.length === 0)) {
                                        return (
                                            <div className="flex flex-col items-center justify-center h-full gap-3 text-[var(--text-muted)] opacity-70">
                                                <Network size={24} className="opacity-50" />
                                                <span className="text-xs font-mono">No structure was extracted for this tree.</span>
                                            </div>
                                        );
                                    }

                                    if (viewingTree.data) {
                                        return <TreeNode node={viewingTree.data} />;
                                    }

                                    return null;
                                })()}
                            </div>
                        </div>
                    )}

                </div>
            </div>
        </div>
    );
};
