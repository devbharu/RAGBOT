/**
 * Sidebar.jsx — CMTI v8.0
 * Claude.ai-style collapsible sidebar
 * - Slim icon-only mode (w-14) or full (w-60)
 * - Chat history with active indicator
 * - Account modal at bottom, same as before
 * - All logic intact, cleaner Tailwind + CSS vars
 */

import React, { useState, useRef, useEffect } from 'react';
import { Menu, X, Plus, LogOut, MessageSquare, User, Settings, HelpCircle, Star, Trash2 } from 'lucide-react';
import { useApp } from '../context/AppContext';
import { useAuth } from '../context/AuthContext';

export default function Sidebar() {
    const { sidebarOpen, setSidebarOpen, chatHistory, activeChat, startNewChat, loadChat, deleteChat } = useApp();
    const { user, logout } = useAuth();
    const [modalOpen, setModalOpen] = useState(false);
    const modalRef = useRef(null);
    const triggerRef = useRef(null);

    const handleLogout = async () => {
        setModalOpen(false);
        await logout();
    };

    const handleDeleteChat = async (chatId, title) => {
        const ok = window.confirm(`Delete chat "${title || "Untitled"}"?`);
        if (!ok) return;
        try {
            await deleteChat(chatId);
        } catch {
            alert("Failed to delete chat. Please try again.");
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
                <div className="fixed inset-0 z-10 bg-black/50 md:hidden" onClick={() => setSidebarOpen(false)} />
            )}

            {/* Sidebar */}
            <aside
                className={`
                    flex flex-col h-screen flex-shrink-0 overflow-hidden
                    transition-all duration-300 ease-[cubic-bezier(0.4,0,0.2,1)]
                    fixed md:static left-0 top-0 bottom-0 z-40
                    ${sidebarOpen ? 'w-60' : 'w-14'}
                `}
                style={{
                    background: "var(--bg-surface)",
                    borderRight: "1px solid var(--border)",
                    fontFamily: "'DM Mono', monospace",
                    color: "var(--text-body)",
                }}
            >
                {/* ── Header ── */}
                <div className="flex items-center h-[52px] px-3 flex-shrink-0 border-b border-[var(--border)]" style={{ justifyContent: sidebarOpen ? 'space-between' : 'center' }}>
                    {sidebarOpen && (
                        <span className="text-[13px] font-semibold tracking-wide overflow-hidden whitespace-nowrap" style={{ color: "var(--accent)", fontFamily: "'Fraunces', serif" }}>
                            CMTI
                        </span>
                    )}
                    <button
                        onClick={() => setSidebarOpen(!sidebarOpen)}
                        className="p-1.5 rounded-lg transition-all flex-shrink-0 border border-[var(--border-mid)] cursor-pointer"
                        style={{ backgroundColor: "var(--bg-panel)", color: "var(--text-muted)" }}
                        title={sidebarOpen ? "Collapse" : "Expand"}
                    >
                        {sidebarOpen ? <X size={15} /> : <Menu size={15} />}
                    </button>
                </div>

                {/* ── New Chat ── */}
                <div className="px-2 pt-3 pb-1 flex-shrink-0">
                    <button
                        onClick={() => { startNewChat(); if (window.innerWidth < 768) setSidebarOpen(false); }}
                        className={`w-full flex items-center py-2.5 text-[12.5px] font-semibold rounded-xl transition-all duration-200 cursor-pointer border-none ${sidebarOpen ? 'px-3 gap-2 justify-start' : 'justify-center px-2'}`}
                        style={{ background: "var(--accent)", color: "#0d0d0d" }}
                        title={sidebarOpen ? "" : "New Chat"}
                    >
                        <Plus size={15} strokeWidth={2.5} />
                        {sidebarOpen && <span>New Chat</span>}
                    </button>
                </div>

                {/* ── History ── */}
                {sidebarOpen ? (
                    <div className="flex-1 overflow-y-auto px-2 py-1 cmti-history">
                        <p className="text-[9px] px-2 py-1.5 uppercase tracking-widest font-mono" style={{ color: "var(--text-faint)" }}>
                            Recent
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
                                            className="w-full rounded-xl font-mono text-[12px] flex items-center gap-1 overflow-hidden whitespace-nowrap transition-all"
                                            style={{
                                                backgroundColor: isActive ? "var(--accent-dim)" : "transparent",
                                                color: isActive ? "var(--accent)" : "var(--text-muted)",
                                            }}
                                            title={chat.title}
                                        >
                                            <button
                                                onClick={() => { loadChat(chat.id); }}
                                                className="flex-1 min-w-0 text-left px-2 py-2 rounded-xl flex items-center gap-2.5 overflow-hidden cursor-pointer border-none bg-transparent"
                                            >
                                                <MessageSquare size={12} style={{ flexShrink: 0, opacity: 0.6 }} />
                                                <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', flex: 1 }}>{chat.title}</span>
                                                {isActive && (
                                                    <span className="w-1.5 h-1.5 rounded-full flex-shrink-0" style={{ background: "var(--accent)" }} />
                                                )}
                                            </button>
                                            <button
                                                onClick={(e) => { e.stopPropagation(); handleDeleteChat(chat.id, chat.title); }}
                                                className="mr-1 w-7 h-7 rounded-lg flex items-center justify-center border-none bg-transparent cursor-pointer opacity-0 group-hover:opacity-100 transition-opacity"
                                                style={{ color: "var(--text-faint)" }}
                                                title="Delete chat"
                                            >
                                                <Trash2 size={12} />
                                            </button>
                                        </div>
                                    </div>
                                );
                            })
                        ) : (
                            <p className="text-[11px] text-center py-8 font-mono" style={{ color: "var(--text-faint)" }}>
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
                                        backgroundColor: isActive ? "var(--accent-dim)" : "transparent",
                                        color: isActive ? "var(--accent)" : "var(--text-faint)",
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
                <div className="flex-shrink-0 px-2 py-3 border-t border-[var(--border)]">
                    {sidebarOpen ? (
                        <button
                            ref={triggerRef}
                            onClick={() => setModalOpen((v) => !v)}
                            className="flex items-center gap-2.5 w-full px-3 py-2 rounded-xl transition-all cursor-pointer border-none hover:bg-[var(--bg-panel)]"
                            style={{ background: "transparent" }}
                        >
                            <div className="w-7 h-7 rounded-full flex items-center justify-center text-[11px] font-bold flex-shrink-0" style={{ background: "var(--accent)", color: "#0d0d0d" }}>
                                {initials}
                            </div>
                            <div className="flex-1 text-left overflow-hidden">
                                <p className="text-[11.5px] font-medium truncate" style={{ color: "var(--text-primary)" }}>
                                    {user?.username || user?.email?.split('@')[0] || 'User'}
                                </p>
                                <p style={{ fontSize: '9px', color: "var(--text-faint)", letterSpacing: '0.06em', marginTop: '1px', textTransform: 'uppercase' }}>
                                    Free Plan
                                </p>
                            </div>
                            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="var(--text-faint)" strokeWidth="2" style={{ transition: 'transform 0.2s', transform: modalOpen ? 'rotate(180deg)' : 'rotate(0deg)', flexShrink: 0 }}>
                                <path d="M18 15l-6-6-6 6" />
                            </svg>
                        </button>
                    ) : (
                        <button
                            ref={triggerRef}
                            onClick={() => setModalOpen((v) => !v)}
                            className="w-full flex justify-center py-1 cursor-pointer border-none"
                            style={{ background: 'transparent' }}
                            title={user?.username || 'Account'}
                        >
                            <div className="w-8 h-8 rounded-full flex items-center justify-center text-[11px] font-bold" style={{ background: "var(--accent)", color: "#0d0d0d" }}>
                                {initials}
                            </div>
                        </button>
                    )}
                </div>
            </aside>

            {/* ── Account Modal ── */}
            {modalOpen && (
                <div
                    ref={modalRef}
                    className="cmti-modal-anim fixed z-50 overflow-hidden"
                    style={{
                        bottom: '14px',
                        left: sidebarOpen ? '14px' : '70px',
                        width: '240px',
                        background: "var(--bg-panel)",
                        border: "1px solid var(--border-mid)",
                        borderRadius: '14px',
                        boxShadow: '0 8px 40px rgba(0,0,0,0.5)',
                        fontFamily: "'DM Mono', monospace",
                    }}
                >
                    {/* User info */}
                    <div className="flex items-center gap-3 px-4 py-3.5" style={{ borderBottom: "1px solid var(--border)" }}>
                        <div className="w-9 h-9 rounded-full flex items-center justify-center text-sm font-bold flex-shrink-0" style={{ background: "var(--accent)", color: "#0d0d0d" }}>
                            {initials}
                        </div>
                        <div className="overflow-hidden">
                            <p className="text-[12px] font-medium truncate" style={{ color: "var(--text-primary)" }}>
                                {user?.username || 'User'}
                            </p>
                            <p className="truncate" style={{ fontSize: '10px', color: "var(--text-faint)", marginTop: '1px' }}>
                                {user?.email || ''}
                            </p>
                            <div className="inline-flex items-center gap-1 mt-1.5 px-1.5 py-0.5 rounded" style={{ background: "var(--accent-dim)", border: "1px solid var(--accent)", fontSize: '9px', color: "var(--accent)", letterSpacing: '0.06em' }}>
                                <Star size={8} fill="currentColor" />FREE
                            </div>
                        </div>
                    </div>

                    {/* Upgrade */}
                    <div className="px-3 py-2.5" style={{ borderBottom: "1px solid var(--border)" }}>
                        <button className="w-full flex items-center justify-center gap-2 px-4 py-2 rounded-xl text-[11.5px] font-semibold cursor-pointer border-none transition-all hover:opacity-88" style={{ background: "var(--accent)", color: "#0d0d0d" }}>
                            <Star size={11} fill="currentColor" />Upgrade Plan
                        </button>
                    </div>

                    {/* Nav */}
                    <div className="py-1.5 px-1" style={{ borderBottom: "1px solid var(--border)" }}>
                        {[
                            { icon: <User size={13} />, label: 'Profile' },
                            { icon: <Settings size={13} />, label: 'Settings' },
                            { icon: <HelpCircle size={13} />, label: 'Help' },
                        ].map(({ icon, label }) => (
                            <button key={label} className="w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-[11.5px] transition-all cursor-pointer border-none text-left font-mono hover:bg-[var(--bg-base)] hover:text-[var(--text-primary)]" style={{ background: 'transparent', color: "var(--text-muted)" }}>
                                <span style={{ opacity: 0.7 }}>{icon}</span>{label}
                            </button>
                        ))}
                    </div>

                    {/* Logout */}
                    <div className="py-1.5 px-1">
                        <button onClick={handleLogout} className="w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-[11.5px] transition-all cursor-pointer border-none text-left font-mono" style={{ background: 'transparent', color: "var(--text-muted)" }}
                            onMouseEnter={e => { e.currentTarget.style.background = 'rgba(224,80,80,0.08)'; e.currentTarget.style.color = '#e05050'; }}
                            onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = 'var(--text-muted)'; }}
                        >
                            <LogOut size={13} style={{ opacity: 0.7 }} />Log out
                        </button>
                    </div>
                </div>
            )}
        </>
    );
}