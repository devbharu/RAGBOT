/**
 * Navbar.jsx — Minimal top navigation bar
 */

import React from 'react';
import { MessageSquare } from 'lucide-react';

export default function Navbar() {
    return (
        <header className="sticky top-0 z-20 backdrop-blur-sm border-b border-[var(--border)] bg-[var(--bg-panel)]">
            <div className="h-14 px-4 flex items-center justify-between">
                <div className="hidden md:flex items-center gap-3">
                    <div className="w-8 h-8 rounded-lg flex items-center justify-center" style={{ background: "var(--accent)", color: "var(--on-accent)" }}>
                        <MessageSquare size={18} />
                    </div>
                    <h1 className="text-lg font-bold text-[var(--accent)]" style={{ fontFamily: "'Fraunces', serif" }}>
                        CMTI Bot
                    </h1>
                </div>

                <div className="flex-1 text-center md:hidden">
                    <h1 className="text-sm font-semibold text-[var(--text-primary)]">CMTI Bot</h1>
                </div>

                <div className="w-8" />
            </div>
        </header>
    );
}
