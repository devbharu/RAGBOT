/**
 * Navbar.jsx — Minimal top navigation bar
 */

import React from 'react';
import { MessageSquare } from 'lucide-react';

export default function Navbar() {
    return (
        <header className="bg-[#1a1a1a] border-b border-[#2a2a2a] sticky top-0 z-20 backdrop-blur-sm">
            <div className="h-14 px-4 flex items-center justify-between">
                {/* Left - Logo (Hidden on mobile when sidebar is open) */}
                <div className="hidden md:flex items-center gap-3">
                    <div className="w-8 h-8 bg-gradient-to-br from-[#FF8081] to-[#ff6b6c] rounded-lg flex items-center justify-center">
                        <MessageSquare size={18} className="text-white" />
                    </div>
                    <h1 className="text-lg font-bold bg-gradient-to-r from-[#FF8081] to-[#ffb3b4] bg-clip-text text-transparent">
                        CMTI Bot
                    </h1>
                </div>

                {/* Center - Page Title (Optional) */}
                <div className="flex-1 text-center md:hidden">
                    <h1 className="text-sm font-semibold text-white">CMTI Bot</h1>
                </div>

                {/* Right - Empty for now (can add theme toggle, settings) */}
                <div className="w-8"></div>
            </div>
        </header>
    );
}
