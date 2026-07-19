/**
 * Sidebar.jsx — CMTI v8.0
 * Claude.ai-style collapsible sidebar
 * - Slim icon-only mode (w-14) or full (w-60)
 * - Chat history with active indicator
 * - Account modal at bottom, same as before
 * - All logic intact, cleaner Tailwind + CSS vars
 */

import React, { useState, useRef, useEffect } from 'react';
import { Menu, X, Plus, LogOut, MessageSquare, User, Settings, HelpCircle, Star, Trash2, Search, Folder, Box, Code, Wrench, Download } from 'lucide-react';
import { useSidebar, useChatStore } from '../context/AppContext';
import { useAuth } from '../context/AuthContext';
import { DashboardModal } from './dashboard/DashboardModal';

export default function Sidebar() {
    const { user, logout } = useAuth();
    const { sidebarOpen, setSidebarOpen } = useSidebar();
    const { chatHistory, activeChat, startNewChat, loadChat, deleteChat } = useChatStore();
    const [scrolled, setScrolled] = useState(false);
    const [modalOpen, setModalOpen] = useState(false);
    const modalRef = useRef(null);
    const triggerRef = useRef(null);

    const handleLogout = async () => {
        setModalOpen(false);
        await logout();
    };

    const [chatToDelete, setChatToDelete] = useState(null);

    const handleDeleteChatClick = (chat) => {
        setChatToDelete(chat);
    };

    const confirmDeleteChat = async () => {
        if (!chatToDelete) return;
        try {
            await deleteChat(chatToDelete.id);
        } catch {
            alert("Failed to delete chat. Please try again.");
        } finally {
            setChatToDelete(null);
        }
    };

    useEffect(() => {
        const handler = (e) => {
            if (
                modalRef.current && !modalRef.current.contains(e.target) &&
                triggerRef.current && !triggerRef.current.contains(e.target)
            ) {
                setModalOpen(false);
            }
        };
        if (modalOpen) document.addEventListener('mousedown', handler);
        return () => document.removeEventListener('mousedown', handler);
    }, [modalOpen]);

    const initials = user?.username?.charAt(0).toUpperCase() || user?.email?.charAt(0).toUpperCase() || 'U';

    return (
        <>
            <style>{`
                @keyframes slideUpModal {
                    from { opacity: 0; transform: translateY(8px) scale(0.98); }
                    to   { opacity: 1; transform: translateY(0) scale(1); }
                }
                .cmti-modal-anim { animation: slideUpModal 0.16s ease forwards; }
                .cmti-history::-webkit-scrollbar { width: 3px; }
                .cmti-history::-webkit-scrollbar-thumb { background: var(--border); border-radius: 2px; }
            `}</style>

            {/* Mobile overlay */}
            {sidebarOpen && (
                <div className="fixed inset-0 z-10 md:hidden" style={{ background: "var(--overlay-bg)" }} onClick={() => setSidebarOpen(false)} />
            )}

            {/* Sidebar */}
            <aside
                className={`
                    flex flex-col h-screen flex-shrink-0 overflow-hidden
                    transition-all duration-300 ease-[cubic-bezier(0.4,0,0.2,1)]
                    fixed md:static left-0 top-0 bottom-0 z-40
                    ${sidebarOpen ? 'w-[260px]' : 'w-14'}
                `}
                style={{
                    background: "var(--bg-surface)",
                    borderRight: "1px solid var(--border)",
                    fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif",
                    color: "var(--text-body)",
                }}
            >
                {/* ── Header ── */}
                <div className="flex items-center h-[52px] px-4 flex-shrink-0" style={{ justifyContent: sidebarOpen ? 'space-between' : 'center' }}>
                    {sidebarOpen && (
                        <span className="text-[17px] tracking-tight overflow-hidden whitespace-nowrap" style={{ color: "var(--text-primary)", fontFamily: "'Fraunces', serif" }}>
                            CMTI
                        </span>
                    )}
                    <button
                        onClick={() => setSidebarOpen(!sidebarOpen)}
                        className="p-1 rounded-lg transition-all flex-shrink-0 border-none cursor-pointer"
                        style={{ backgroundColor: "transparent", color: "var(--text-muted)" }}
                        title={sidebarOpen ? "Collapse sidebar" : "Expand sidebar"}
                    >
                        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"></rect><line x1="9" y1="3" x2="9" y2="21"></line></svg>
                    </button>
                </div>

                {/* ── Nav Links ── */}
                <div className="px-3 pt-2 pb-1 flex-shrink-0 flex flex-col gap-0.5">
                    <button
                        onClick={() => { startNewChat(); if (window.innerWidth < 768) setSidebarOpen(false); }}
                        className={`w-full flex items-center py-2 text-[13.5px] font-medium rounded-lg transition-all duration-200 cursor-pointer border-none hover:bg-[var(--bg-elevated)] ${sidebarOpen ? 'px-3 gap-3 justify-start' : 'justify-center px-2'}`}
                        style={{ background: "transparent", color: "var(--text-primary)" }}
                        title={sidebarOpen ? "" : "New chat"}
                    >
                        <Plus size={16} style={{ color: "var(--text-muted)" }} />
                        {sidebarOpen && <span>New chat</span>}
                    </button>
                    
                    <button className={`w-full flex items-center py-2 text-[13.5px] font-medium rounded-lg transition-all duration-200 cursor-pointer border-none hover:bg-[var(--bg-elevated)] ${sidebarOpen ? 'px-3 gap-3 justify-start' : 'justify-center px-2'}`} style={{ background: "transparent", color: "var(--text-primary)" }}>
                        <Search size={16} style={{ color: "var(--text-muted)" }} />
                        {sidebarOpen && <span>Search</span>}
                    </button>
                    <button className={`w-full flex items-center py-2 text-[13.5px] font-medium rounded-lg transition-all duration-200 cursor-pointer border-none hover:bg-[var(--bg-elevated)] ${sidebarOpen ? 'px-3 gap-3 justify-start' : 'justify-center px-2'}`} style={{ background: "transparent", color: "var(--text-primary)" }}>
                        <MessageSquare size={16} style={{ color: "var(--text-muted)" }} />
                        {sidebarOpen && <span>Chats</span>}
                    </button>
                </div>

                {/* ── History ── */}
                {sidebarOpen ? (
                    <div className="flex-1 overflow-y-auto px-3 py-1 cmti-history">
                        <p className="text-[12.5px] px-2 py-2 font-medium" style={{ color: "var(--text-primary)" }}>
                            Recents
                        </p>

                        {chatHistory && chatHistory.length > 0 ? (
                            chatHistory.map((chat) => {
                                const isActive = activeChat === chat.id;
                                return (
                                    <div
                                        key={chat.id}
                                        className="group w-full px-1 py-0.5"
                                    >
                                        <div
                                            className="w-full rounded-lg text-[13.5px] flex items-center gap-1 overflow-hidden whitespace-nowrap transition-all"
                                            style={{
                                                backgroundColor: isActive ? "var(--bg-elevated)" : "transparent",
                                                color: isActive ? "var(--text-primary)" : "var(--text-muted)",
                                            }}
                                            title={chat.title}
                                        >
                                            <button
                                                onClick={() => { loadChat(chat.id); }}
                                                className="flex-1 min-w-0 text-left px-2 py-2 rounded-lg flex items-center gap-2.5 overflow-hidden cursor-pointer border-none bg-transparent"
                                            >
                                                <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', flex: 1, opacity: isActive ? 1 : 0.85 }}>{chat.title}</span>
                                            </button>
                                            <button
                                                onClick={(e) => { e.stopPropagation(); handleDeleteChatClick(chat); }}
                                                className="mr-1 w-7 h-7 rounded-lg flex items-center justify-center border-none bg-transparent cursor-pointer opacity-0 group-hover:opacity-100 transition-opacity"
                                                style={{ color: "var(--text-faint)" }}
                                                title="Delete chat"
                                            >
                                                <Trash2 size={13} />
                                            </button>
                                        </div>
                                    </div>
                                );
                            })
                        ) : (
                            <p className="text-[12px] text-center py-8" style={{ color: "var(--text-faint)" }}>
                                No chats yet
                            </p>
                        )}
                    </div>
                ) : (
                    /* Collapsed: just show icons for recent chats */
                    <div className="flex-1 overflow-hidden flex flex-col items-center gap-1 py-2">
                        {chatHistory?.slice(0, 6).map((chat) => {
                            const isActive = activeChat === chat.id;
                            return (
                                <button
                                    key={chat.id}
                                    onClick={() => { loadChat(chat.id); }}
                                    className="w-9 h-9 rounded-xl flex items-center justify-center transition-all cursor-pointer border-none"
                                    style={{
                                        backgroundColor: isActive ? "var(--bg-elevated)" : "transparent",
                                        color: isActive ? "var(--text-primary)" : "var(--text-faint)",
                                    }}
                                    title={chat.title}
                                >
                                    <MessageSquare size={14} />
                                </button>
                            );
                        })}
                    </div>
                )}

                {/* ── Account trigger ── */}
                <div className="flex-shrink-0 px-3 py-3">
                    {sidebarOpen ? (
                        <button
                            ref={triggerRef}
                            onClick={() => setModalOpen((v) => !v)}
                            className="flex items-center gap-2.5 w-full px-2 py-1.5 rounded-lg transition-all cursor-pointer border-none hover:bg-[var(--bg-elevated)]"
                            style={{ background: "transparent" }}
                        >
                            <div className="w-7 h-7 rounded-full flex items-center justify-center text-[12px] font-bold flex-shrink-0" style={{ background: "#e0e0e0", color: "#333" }}>
                                {initials}
                            </div>
                            <div className="flex-1 text-left overflow-hidden">
                                <p className="text-[13px] font-medium truncate" style={{ color: "var(--text-primary)" }}>
                                    {user?.username || user?.email?.split('@')[0] || 'User'}
                                </p>
                            </div>
                            <Download size={15} className="text-[var(--text-muted)] hover:text-[var(--text-primary)] transition-colors flex-shrink-0" />
                        </button>
                    ) : (
                        <button
                            ref={triggerRef}
                            onClick={() => setModalOpen((v) => !v)}
                            className="w-full flex justify-center py-1 cursor-pointer border-none"
                            style={{ background: 'transparent' }}
                            title={user?.username || 'Account'}
                        >
                            <div className="w-8 h-8 rounded-full flex items-center justify-center text-[12px] font-bold" style={{ background: "#e0e0e0", color: "#333" }}>
                                {initials}
                            </div>
                        </button>
                    )}
                </div>
            </aside>

            {/* ── Dashboard Modal ── */}
            {modalOpen && <DashboardModal onClose={() => setModalOpen(false)} />}

            {/* ── Delete Confirmation Modal ── */}
            {chatToDelete && (
                <div className="fixed inset-0 z-[200] flex items-center justify-center backdrop-blur-sm" style={{ background: "var(--overlay-bg)" }} onClick={() => setChatToDelete(null)}>
                    <div className="bg-[var(--bg-panel)] border border-[var(--border-mid)] rounded-2xl p-6 w-[360px] shadow-2xl animate-[fadeIn_0.15s_ease-out]" onClick={(e) => e.stopPropagation()}>
                        <h3 className="text-[17px] font-semibold text-[var(--text-primary)] mb-2 tracking-tight">Delete Chat</h3>
                        <p className="text-[14px] text-[var(--text-body)] mb-6 leading-relaxed">
                            Are you sure you want to delete <strong className="text-[var(--text-primary)] font-medium">"{chatToDelete.title || "Untitled"}"</strong>? This action cannot be undone.
                        </p>
                        <div className="flex gap-3 justify-end">
                            <button
                                onClick={() => setChatToDelete(null)}
                                className="px-4 py-2 rounded-xl border border-[var(--border)] bg-transparent text-[var(--text-body)] text-sm cursor-pointer hover:bg-[var(--bg-elevated)] transition-colors"
                            >
                                Cancel
                            </button>
                            <button
                                onClick={confirmDeleteChat}
                                className="px-4 py-2 rounded-xl border-none bg-red-500 hover:bg-red-600 text-white text-sm font-medium cursor-pointer transition-colors shadow-sm"
                            >
                                Delete
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </>
    );
}