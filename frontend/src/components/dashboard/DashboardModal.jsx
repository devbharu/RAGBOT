import React, { useState, useEffect } from 'react';
import axios from 'axios';
import { 
    X, Database, Network, Search, Loader2, CheckCircle, 
    XCircle, ArrowLeft, PlayCircle, ChevronRight, ChevronDown, 
    FileText, User, Settings, HelpCircle, FileBarChart, Trash2, Upload, LogOut, Copy, Box
} from 'lucide-react';
import { API, useFileStore } from '../../context/AppContext';
import { useAuth } from '../../context/AuthContext';
import { useTheme } from '../../context/ThemeContext';

// Include the TreeNode component inline for the Tree Visualizer
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
                <div style={{ width: depth * 18 }} className="flex-shrink-0" />
                <div className="flex items-center justify-center w-5 h-5 mr-1.5 flex-shrink-0 mt-[1px]">
                    {hasChildren ? (
                        <button onClick={() => setOpen(!open)} className="text-[var(--text-faint)] hover:text-[var(--text-primary)] cursor-pointer bg-transparent border-none p-0 transition-colors flex items-center justify-center">
                            {open ? <ChevronDown size={14} strokeWidth={2} /> : <ChevronRight size={14} strokeWidth={2} />}
                        </button>
                    ) : (
                        <FileText size={13} className="text-[var(--text-faint)] opacity-70" strokeWidth={1.5} />
                    )}
                </div>
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
            
            {open && hasChildren && (
                <div className="flex flex-col relative">
                    <div className="absolute top-1 bottom-2 w-[1px] bg-[var(--border)]" style={{ left: (depth * 18) + 9.5 }} />
                    {node.nodes.map((child, i) => <TreeNode key={i} node={child} depth={depth + 1} />)}
                </div>
            )}
        </div>
    );
};

export const DashboardModal = ({ onClose }) => {
    const { user } = useAuth();
    const { fetchFiles } = useFileStore(); // To refresh sidebar if needed
    const [activeTab, setActiveTab] = useState('pdf'); // 'pdf', 'user', 'reports'
    
    // PDF Tab State
    const [searchQuery, setSearchQuery] = useState('');
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);
    const [analyticsData, setAnalyticsData] = useState([]);
    const [viewingTree, setViewingTree] = useState(null); 
    
    // User Settings State
    const { isDark, toggleTheme } = useTheme();
    const [retrievalPreference, setRetrievalPreference] = useState(user?.preferences?.retrieval || 'vector');

    const { logout, syncPreferences } = useAuth();
    
    // Reports State
    const [reports, setReports] = useState([]);
    const [loadingReports, setLoadingReports] = useState(false);
    const [expandedReportId, setExpandedReportId] = useState(null);
    const [copiedReportId, setCopiedReportId] = useState(null);

    const handleLogout = async () => {
        onClose();
        await logout();
    };

    const handleThemeChange = () => {
        toggleTheme();
        syncPreferences({ theme: !isDark ? 'dark' : 'light' });
    };

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
        if (activeTab === 'pdf') {
            fetchAnalytics();
        } else if (activeTab === 'reports') {
            fetchReports();
        }
    }, [activeTab]);

    const fetchReports = async () => {
        setLoadingReports(true);
        try {
            const token = localStorage.getItem("access_token");
            const headers = token ? { Authorization: `Bearer ${token}` } : {};
            const res = await axios.get(`${API}/reports`, { headers });
            setReports(res.data.reports || []);
        } catch (err) {
            console.error("Error fetching reports:", err);
        } finally {
            setLoadingReports(false);
        }
    };

    const handleDeleteReport = async (reportId) => {
        if (!window.confirm("Are you sure you want to delete this report?")) return;
        try {
            const token = localStorage.getItem("access_token");
            const headers = token ? { Authorization: `Bearer ${token}` } : {};
            await axios.delete(`${API}/reports/${reportId}`, { headers });
            fetchReports();
        } catch (err) {
            alert(`Error deleting report: ${err.response?.data?.error || err.message}`);
        }
    };

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
            fetchAnalytics();
        } catch (err) {
            alert(`Error building premium tree: ${err.response?.data?.error || err.message}`);
        }
    };

    const handleDeleteFile = async (filename) => {
        const ok = window.confirm(`Are you sure you want to delete ${filename}?`);
        if (!ok) return;
        try {
            await axios.post(`${API}/delete`, { filename });
            fetchAnalytics();
            fetchFiles(); // Update main app state
        } catch (err) {
            alert(`Error deleting file: ${err.response?.data?.error || err.message}`);
        }
    };

    // Auto-poll if building
    useEffect(() => {
        let interval;
        const isBuilding = analyticsData.some(doc => doc.build_status && doc.build_status.status === "building" || doc.build_status?.status === "optimizing");
        if (isBuilding && activeTab === 'pdf') {
            interval = setInterval(() => {
                fetchAnalytics();
            }, 3000);
        }
        return () => clearInterval(interval);
    }, [analyticsData, activeTab]);

    const StatusBadge = ({ active, label, icon: Icon, colorClass, onClick, interactive }) => (
        <button 
            onClick={active && interactive ? onClick : undefined}
            className={`flex items-center gap-1.5 px-2 py-1 rounded-md text-[10px] font-mono font-semibold border transition-all ${active ? colorClass : 'bg-[var(--bg-elevated)] border-[var(--border-mid)] text-[var(--text-faint)]'} ${active && interactive ? 'cursor-pointer hover:opacity-80' : 'cursor-default'}`}>
            {Icon && <Icon size={12} />}
            {label}
            {active ? <CheckCircle size={10} className="ml-1" /> : <XCircle size={10} className="ml-1 opacity-50" />}
        </button>
    );

    const filteredDocs = analyticsData.filter(doc => doc.filename.toLowerCase().includes(searchQuery.toLowerCase()));

    return (
        <div className="fixed inset-0 z-[300] flex items-center justify-center backdrop-blur-sm animate-[fadeIn_0.15s_ease]" style={{ background: "var(--overlay-bg)" }} onClick={onClose}>
            <div className={`relative overflow-hidden w-full mx-4 bg-[var(--bg-panel)] border border-[var(--border-mid)] rounded-2xl flex flex-col shadow-2xl animate-[fadeSlideUp_0.2s_ease] max-h-[85vh] transition-all duration-300 ${viewingTree ? 'max-w-6xl' : 'max-w-5xl'}`} onClick={e => e.stopPropagation()}>
                
                {/* Header */}
                <div className="flex items-center justify-between p-5 border-b border-[var(--border)] shrink-0 bg-[var(--bg-panel)] z-10">
                    <div className="flex items-center gap-3 text-[var(--text-primary)]">
                        {viewingTree ? (
                            <button onClick={() => setViewingTree(null)} className="p-2 bg-[var(--bg-elevated)] text-[var(--text-muted)] rounded-lg hover:text-[var(--accent)] cursor-pointer border-none transition-colors">
                                <ArrowLeft size={18} />
                            </button>
                        ) : (
                            <div className="p-2 bg-[var(--accent-dim)] text-[var(--accent)] rounded-lg">
                                <User size={18} />
                            </div>
                        )}
                        <div>
                            <h2 className="text-sm font-medium m-0" style={{ fontFamily: "'Fraunces', serif" }}>
                                {viewingTree ? `Tree Visualizer: ${viewingTree.filename}` : "User Dashboard"}
                            </h2>
                            <p className="text-[10px] text-[var(--text-faint)] mt-0.5 tracking-widest uppercase font-mono">
                                {viewingTree ? `${viewingTree.type} Tree` : "Manage PDFs, Settings, and Reports"}
                            </p>
                        </div>
                    </div>
                    <button onClick={onClose} className="p-1.5 rounded-lg bg-transparent border border-[var(--border-mid)] cursor-pointer text-[var(--text-muted)] flex items-center justify-center transition-all hover:bg-[var(--bg-elevated)] hover:text-[var(--text-primary)]">
                        <X size={14} />
                    </button>
                </div>

                {/* Body - Split Layout */}
                <div className="flex overflow-hidden relative" style={{ backgroundColor: "var(--bg-surface)", height: "65vh" }}>
                    
                    {/* Sidebar Tabs */}
                    {!viewingTree && (
                        <div className="w-48 border-r border-[var(--border)] bg-[var(--bg-panel)] shrink-0 flex flex-col py-4">
                            <button onClick={() => setActiveTab('pdf')} className={`flex items-center gap-3 px-4 py-3 text-xs font-mono transition-colors border-none cursor-pointer ${activeTab === 'pdf' ? 'text-[var(--accent)] bg-[var(--accent-dim)] border-r-2 border-[var(--accent)]' : 'text-[var(--text-muted)] hover:text-[var(--text-primary)] bg-transparent'}`}>
                                <Database size={16} /> PDF Management
                            </button>
                            <button onClick={() => setActiveTab('user')} className={`flex items-center gap-3 px-4 py-3 text-xs font-mono transition-colors border-none cursor-pointer ${activeTab === 'user' ? 'text-[var(--accent)] bg-[var(--accent-dim)] border-r-2 border-[var(--accent)]' : 'text-[var(--text-muted)] hover:text-[var(--text-primary)] bg-transparent'}`}>
                                <Settings size={16} /> User Preferences
                            </button>
                            <button onClick={() => setActiveTab('reports')} className={`flex items-center gap-3 px-4 py-3 text-xs font-mono transition-colors border-none cursor-pointer ${activeTab === 'reports' ? 'text-[var(--accent)] bg-[var(--accent-dim)] border-r-2 border-[var(--accent)]' : 'text-[var(--text-muted)] hover:text-[var(--text-primary)] bg-transparent'}`}>
                                <Box size={16} /> Artifacts & Reports
                            </button>
                            <div className="mt-auto px-2">
                                <button onClick={handleLogout} className="w-full flex items-center gap-3 px-3 py-2 rounded-lg text-xs font-mono transition-all border-none cursor-pointer text-[var(--text-muted)] hover:bg-[var(--red-dim)] hover:text-[var(--red-soft)] bg-transparent">
                                    <LogOut size={16} /> Log Out
                                </button>
                            </div>
                        </div>
                    )}

                    {/* PDF Management Tab */}
                    {activeTab === 'pdf' && (
                        <>
                            <div className={`flex flex-col overflow-y-auto shrink-0 transition-all duration-300 ${viewingTree ? 'w-2/5 border-r border-[var(--border)]' : 'flex-1'}`}>
                                {!viewingTree && (
                                    <div className="p-5 border-b border-[var(--border)]">
                                        <div className="flex items-center bg-[var(--bg-input)] border border-[var(--border-mid)] rounded-xl px-3 py-2 text-[var(--text-primary)] focus-within:border-[var(--accent)] transition-colors">
                                            <Search size={16} className="text-[var(--text-muted)] mr-2" />
                                            <input 
                                                type="text" 
                                                value={searchQuery}
                                                onChange={(e) => setSearchQuery(e.target.value)}
                                                placeholder="Search documents..." 
                                                className="bg-transparent border-none outline-none flex-1 text-sm text-[var(--text-primary)] placeholder-[var(--text-faint)]"
                                            />
                                        </div>
                                    </div>
                                )}
                                
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
                                    ) : filteredDocs.length === 0 ? (
                                        <div className="text-center py-8 text-xs text-[var(--text-faint)] font-mono">
                                            No documents found matching your search.
                                        </div>
                                    ) : (
                                        filteredDocs.map(doc => {
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
                                                            <>
                                                                <StatusBadge 
                                                                    active={doc.has_vector} 
                                                                    label="Vector" 
                                                                    icon={Search} 
                                                                    colorClass="bg-[var(--accent-dim)] border-[var(--accent)]/30 text-[var(--accent)]"
                                                                />
                                                                <button onClick={() => handleDeleteFile(doc.filename)} className="p-1.5 rounded bg-transparent border-none text-[var(--red)] hover:bg-[var(--red-soft)] cursor-pointer transition-colors" title="Delete Document">
                                                                    <Trash2 size={13} />
                                                                </button>
                                                            </>
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
                        </>
                    )}

                    {/* User Info Tab */}
                    {activeTab === 'user' && !viewingTree && (
                        <div className="flex-1 overflow-y-auto p-8 flex flex-col gap-6 text-[var(--text-primary)]">
                            <div className="flex items-center gap-4 border-b border-[var(--border)] pb-6">
                                <div className="w-16 h-16 rounded-full flex items-center justify-center text-2xl font-bold bg-[var(--accent)] text-[var(--on-accent)]">
                                    {user?.username?.charAt(0).toUpperCase() || 'U'}
                                </div>
                                <div>
                                    <h3 className="text-xl font-medium m-0">{user?.username}</h3>
                                    <p className="text-sm text-[var(--text-muted)] mt-1">{user?.email}</p>
                                </div>
                            </div>
                            
                            <div>
                                <h4 className="text-sm font-semibold mb-3">Preferences</h4>
                                <div className="flex flex-col gap-3">
                                    <div className="flex items-center justify-between p-4 bg-[var(--bg-elevated)] border border-[var(--border-mid)] rounded-xl">
                                        <div>
                                            <p className="text-sm font-medium">Dark Mode</p>
                                            <p className="text-xs text-[var(--text-muted)] mt-1">Toggle application theme</p>
                                        </div>
                                        <label className="relative inline-flex items-center cursor-pointer">
                                            <input type="checkbox" className="sr-only peer" checked={isDark} onChange={handleThemeChange} />
                                            <div className="w-11 h-6 bg-[var(--border)] peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-[var(--accent)]"></div>
                                        </label>
                                    </div>

                                    <div className="flex items-center justify-between p-4 bg-[var(--bg-elevated)] border border-[var(--border-mid)] rounded-xl">
                                        <div>
                                            <p className="text-sm font-medium">Default Retrieval Mode</p>
                                            <p className="text-xs text-[var(--text-muted)] mt-1">Choose between Tree or Vector retrieval</p>
                                        </div>
                                        <div className="flex bg-[var(--bg-input)] rounded-lg p-1 border border-[var(--border-mid)]">
                                            <button 
                                                onClick={() => {
                                                    setRetrievalPreference('vector');
                                                    syncPreferences({ retrieval: 'vector' });
                                                }}
                                                className={`px-3 py-1.5 text-xs font-medium rounded-md transition-all cursor-pointer border-none ${retrievalPreference === 'vector' ? 'bg-[var(--accent)] text-white shadow-sm' : 'bg-transparent text-[var(--text-muted)] hover:text-[var(--text-primary)]'}`}
                                            >
                                                Vector
                                            </button>
                                            <button 
                                                onClick={() => {
                                                    setRetrievalPreference('tree');
                                                    syncPreferences({ retrieval: 'tree' });
                                                }}
                                                className={`px-3 py-1.5 text-xs font-medium rounded-md transition-all cursor-pointer border-none ${retrievalPreference === 'tree' ? 'bg-[#22c55e] text-white shadow-sm' : 'bg-transparent text-[var(--text-muted)] hover:text-[var(--text-primary)]'}`}
                                            >
                                                Tree
                                            </button>
                                        </div>
                                    </div>


                                </div>
                            </div>
                        </div>
                    )}

                    {/* Reports Tab */}
                    {activeTab === 'reports' && !viewingTree && (
                        <div className="flex-1 overflow-y-auto p-8 flex flex-col gap-4 text-[var(--text-primary)]">
                            <h3 className="text-xl font-medium mb-4">Artifacts & Reports</h3>
                            
                            {loadingReports ? (
                                <div className="flex justify-center py-12">
                                    <Loader2 size={24} className="animate-spin text-[var(--accent)]" />
                                </div>
                            ) : reports.length === 0 ? (
                                <div className="text-center py-16 flex flex-col items-center gap-3">
                                    <Box size={32} className="text-[var(--text-faint)]" />
                                    <h3 className="text-sm font-medium">No saved artifacts or reports yet.</h3>
                                    <p className="text-xs text-[var(--text-muted)] max-w-md">Generate LaTeX artifacts and reports using the Agent mode with the Report graph tool enabled.</p>
                                </div>
                            ) : (
                                <div className="flex flex-col gap-4">
                                    {reports.map((report) => (
                                        <div key={report.id} className="bg-[var(--bg-elevated)] border border-[var(--border-mid)] rounded-xl overflow-hidden">
                                            <div className="p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                                                <div>
                                                    <h4 className="font-semibold text-sm">{report.title}</h4>
                                                    <p className="text-[10px] text-[var(--text-muted)] mt-1 font-mono">
                                                        {new Date(report.createdAt).toLocaleString()}
                                                    </p>
                                                </div>
                                                <div className="flex items-center gap-2">
                                                    <button 
                                                        onClick={() => {
                                                            navigator.clipboard.writeText(report.content);
                                                            setCopiedReportId(report.id);
                                                            setTimeout(() => setCopiedReportId(null), 2000);
                                                        }}
                                                        className="px-3 py-1.5 text-xs font-medium rounded-md bg-[var(--bg-input)] border border-[var(--border)] cursor-pointer hover:bg-[var(--bg-surface)] text-[var(--text-primary)] transition-colors flex items-center gap-1.5"
                                                    >
                                                        {copiedReportId === report.id ? <CheckCircle size={14} className="text-green-500" /> : <Copy size={14} />}
                                                        {copiedReportId === report.id ? 'Copied!' : 'Copy'}
                                                    </button>
                                                    <button 
                                                        onClick={() => setExpandedReportId(expandedReportId === report.id ? null : report.id)}
                                                        className="px-3 py-1.5 text-xs font-medium rounded-md bg-[var(--bg-input)] border border-[var(--border)] cursor-pointer hover:bg-[var(--bg-surface)] text-[var(--text-primary)] transition-colors"
                                                    >
                                                        {expandedReportId === report.id ? 'Hide LaTeX' : 'View LaTeX'}
                                                    </button>
                                                    <button 
                                                        onClick={() => handleDeleteReport(report.id)}
                                                        className="p-1.5 rounded-md border border-transparent hover:bg-[var(--red-dim)] hover:text-[var(--red)] cursor-pointer text-[var(--text-muted)] transition-colors"
                                                    >
                                                        <Trash2 size={14} />
                                                    </button>
                                                </div>
                                            </div>
                                            {expandedReportId === report.id && (
                                                <div className="bg-[#1e1e1e] border-t border-[var(--border-mid)] p-4 max-h-96 overflow-y-auto">
                                                    <pre className="text-[10px] sm:text-xs font-mono text-gray-300 whitespace-pre-wrap">
                                                        {report.content}
                                                    </pre>
                                                </div>
                                            )}
                                        </div>
                                    ))}
                                </div>
                            )}
                        </div>
                    )}

                </div>
            </div>
        </div>
    );
};
