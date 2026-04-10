/**
 * Sidebar.jsx — ChatGPT-style sidebar with theme support
 * Features: Toggle animation, chat history, new chat, user info
 */

import React from 'react';
import { Menu, Plus, LogOut, X } from 'lucide-react';
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
            {/* Hamburger Menu Button (Mobile) */}
            <button
                onClick={() => setSidebarOpen(!sidebarOpen)}
                className="fixed top-4 left-4 z-40 md:hidden p-2 rounded-lg border transition-all"
                style={{ 
                    backgroundColor: "var(--bg-panel)", 
                    borderColor: "var(--border-mid)", 
                    color: "var(--text-muted)" 
                }}
                title="Toggle sidebar"
            >
                {sidebarOpen ? <X size={20} /> : <Menu size={20} />}
            </button>

            {/* Overlay (Mobile) */}
            {sidebarOpen && (
                <div
                    className="fixed inset-0 z-10 bg-black/50 md:hidden"
                    onClick={() => setSidebarOpen(false)}
                />
            )}

            {/* Sidebar Container */}
            <div
                className={`
                    fixed left-0 top-0 bottom-0 w-64 flex flex-col z-30 transition-transform duration-300 ease-out
                    ${sidebarOpen ? 'translate-x-0' : '-translate-x-full'}
                    md:translate-x-0 md:static md:z-0
                `}
                style={{ background: "var(--bg-surface)", color: "var(--text-body)", borderRight: "1px solid var(--border)", fontFamily: "'DM Mono', monospace" }}
            >
                {/* User Section */}
                <div className="p-4 space-y-3" style={{ borderBottom: "1px solid var(--border)" }}>
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

                {/* New Chat Button */}
                <button
                    onClick={() => {
                        startNewChat();
                        setSidebarOpen(false);
                    }}
                    className="m-4 flex items-center justify-center gap-2 px-4 py-2.5 text-white text-sm font-medium rounded-lg transition-all duration-200"
                    style={{ 
                        background: "var(--accent)",
                        color: "white"
                    }}
                >
                    <Plus size={18} />
                    <span>New Chat</span>
                </button>

                {/* Chat History */}
                <div className="flex-1 overflow-y-auto px-3 space-y-1">
                    <p className="text-xs font-semibold px-2 py-2 uppercase tracking-wider" style={{ color: "var(--text-faint)" }}>History</p>
                    {chatHistory && chatHistory.length > 0 ? (
                        chatHistory.map((chat) => (
                            <button
                                key={chat.id}
                                onClick={() => {
                                    loadChat(chat.id);
                                    setActiveChat(chat.id);
                                    setSidebarOpen(false);
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

                {/* Footer Info */}
                <div className="p-4 text-center" style={{ borderTop: "1px solid var(--border)" }}>
                    <p className="text-xs" style={{ color: "var(--text-faint)" }}>CMTI Bot v1.0</p>
                </div>
            </div>
        </>
    );
}
