/**
 * Sidebar.jsx — ChatGPT-style collapsible sidebar
 * Features: Toggle between icon-only and full sidebar, persistent icon bar
 */

import React from 'react';
import { Menu, X, Plus, LogOut, MessageSquare } from 'lucide-react';
import { useApp } from '../context/AppContext';
import { useAuth } from '../context/AuthContext';

export default function Sidebar() {
    const { sidebarOpen, setSidebarOpen, chatHistory, activeChat, setActiveChat, startNewChat, loadChat } = useApp();
    const { user, logout } = useAuth();

    const handleLogout = async () => {
        await logout();
    };

    return (
        <>
            {/* Mobile Overlay */}
            {sidebarOpen && (
                <div
                    className="fixed inset-0 z-10 bg-black/50 md:hidden"
                    onClick={() => setSidebarOpen(false)}
                />
            )}

            {/* Sidebar Container - Always visible, toggles width */}
            <div
                className={`
                    flex flex-col h-screen transition-all duration-300 ease-out
                    ${sidebarOpen ? 'w-64' : 'w-20'}
                    fixed md:static left-0 top-0 bottom-0 z-40
                    overflow-hidden flex-shrink-0
                `}
                style={{ 
                    background: "var(--bg-surface)", 
                    color: "var(--text-body)", 
                    borderRight: "1px solid var(--border)", 
                    fontFamily: "'DM Mono', monospace"
                }}
            >
                {/* Header with Hamburger - Always visible */}
                <div 
                    className="flex items-center justify-between p-3 flex-shrink-0" 
                    style={{ borderBottom: "1px solid var(--border)" }}
                >
                    {sidebarOpen && (
                        <h2 className="text-sm font-semibold text-ellipsis overflow-hidden whitespace-nowrap" style={{ color: "var(--text-primary)" }}>
                            CMTI
                        </h2>
                    )}
                    <button
                        onClick={() => setSidebarOpen(!sidebarOpen)}
                        className="p-1.5 rounded-lg transition-all flex-shrink-0"
                        style={{ 
                            backgroundColor: "var(--bg-panel)", 
                            borderColor: "var(--border-mid)", 
                            color: "var(--text-muted)",
                            border: "1px solid var(--border-mid)"
                        }}
                        title={sidebarOpen ? "Collapse sidebar" : "Expand sidebar"}
                    >
                        {sidebarOpen ? <X size={18} /> : <Menu size={18} />}
                    </button>
                </div>

                {/* User Section - Visible when expanded */}
                {sidebarOpen && (
                    <div className="p-4 space-y-3 flex-shrink-0" style={{ borderBottom: "1px solid var(--border)" }}>
                        <div className="flex items-center gap-3">
                            <div className="w-10 h-10 rounded-full flex items-center justify-center flex-shrink-0 text-white font-bold text-sm" style={{ background: "var(--accent)" }}>
                                {user?.username?.charAt(0).toUpperCase() || 'U'}
                            </div>
                            <div className="flex-1 min-w-0">
                                <p className="text-sm font-medium truncate" style={{ color: "var(--text-primary)" }}>{user?.username || 'User'}</p>
                                <p className="text-xs truncate" style={{ color: "var(--text-faint)" }}>{user?.email || ''}</p>
                            </div>
                        </div>
                        <button
                            onClick={handleLogout}
                            className="w-full flex items-center justify-center gap-2 px-3 py-2 text-sm rounded-lg transition-all duration-200"
                            style={{ color: "var(--text-muted)", borderColor: "var(--border-mid)", border: "1px solid var(--border-mid)", backgroundColor: "transparent" }}>
                            <LogOut size={16} />
                            <span>Logout</span>
                        </button>
                    </div>
                )}

                {/* New Chat Button - Icon only when collapsed */}
                <button
                    onClick={() => {
                        startNewChat();
                        setSidebarOpen(false);
                    }}
                    className={`m-3 flex ${sidebarOpen ? 'justify-start' : 'justify-center'} items-center ${sidebarOpen ? 'gap-2' : 'gap-0'} px-4 py-2.5 text-white text-sm font-medium rounded-lg transition-all duration-200 flex-shrink-0`}
                    style={{ 
                        background: "var(--accent)",
                        color: "white"
                    }}
                    title={sidebarOpen ? "" : "New Chat"}
                >
                    <Plus size={18} />
                    {sidebarOpen && <span>New Chat</span>}
                </button>

                {/* Chat History - Visible when expanded */}
                {sidebarOpen && (
                    <div className="flex-1 overflow-y-auto px-3 space-y-1 min-w-0">
                        <p className="text-xs font-semibold px-2 py-2 uppercase tracking-wider flex-shrink-0" style={{ color: "var(--text-faint)" }}>History</p>
                        {chatHistory && chatHistory.length > 0 ? (
                            chatHistory.map((chat) => (
                                <button
                                    key={chat.id}
                                    onClick={() => {
                                        loadChat(chat.id);
                                        setActiveChat(chat.id);
                                    }}
                                    className="w-full text-left px-3 py-2.5 rounded-lg text-sm transition-all duration-200 truncate relative border"
                                    style={{
                                        backgroundColor: activeChat === chat.id ? "var(--accent-dim)" : "transparent",
                                        color: activeChat === chat.id ? "var(--accent)" : "var(--text-muted)",
                                        borderColor: activeChat === chat.id ? "var(--accent)" : "transparent"
                                    }}
                                    title={chat.title}
                                >
                                    <div className="flex items-center gap-2 truncate">
                                        <span className="text-xs opacity-70">💬</span>
                                        <span className="truncate flex-1">{chat.title}</span>
                                    </div>
                                    {activeChat === chat.id && (
                                        <div className="absolute right-3 top-1/2 transform -translate-y-1/2 w-1 h-6 rounded-full" style={{ background: "var(--accent)" }}></div>
                                    )}
                                </button>
                            ))
                        ) : (
                            <p className="text-xs text-center py-8" style={{ color: "var(--text-faint)" }}>No chats yet</p>
                        )}
                    </div>
                )}

                {/* Footer - Icon or text based on state */}
                {sidebarOpen ? (
                    <div className="p-4 text-center flex-shrink-0" style={{ borderTop: "1px solid var(--border)" }}>
                        <p className="text-xs" style={{ color: "var(--text-faint)" }}>CMTI Bot v1.0</p>
                    </div>
                ) : (
                    <div className="p-2 flex justify-center flex-shrink-0" style={{ borderTop: "1px solid var(--border)" }}>
                        <div className="w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold text-white" style={{ background: "var(--accent)" }}>
                            {user?.username?.charAt(0).toUpperCase() || 'U'}
                        </div>
                    </div>
                )}
            </div>
        </>
    );
}
