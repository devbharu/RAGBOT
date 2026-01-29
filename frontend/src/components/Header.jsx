import React, { useState } from 'react';
import { Menu, X, Settings, Moon, Sun, MessageSquare, Trash2 } from 'lucide-react';

const Header = () => {
    const [isDark, setIsDark] = useState(true);
    const [showMenu, setShowMenu] = useState(false);

    return (
        <header className="bg-[#1a1a1a] border-b border-[#2a2a2a] sticky top-0 z-50 backdrop-blur-sm">
            <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
                <div className="flex items-center justify-between h-16">
                    {/* Left - Logo/Brand */}
                    <div className="flex items-center gap-3">
                        <div className="w-9 h-9 bg-gradient-to-br from-[#FF8081] to-[#ff6b6c] rounded-xl flex items-center justify-center shadow-lg shadow-[#FF8081]/30">
                            <MessageSquare size={20} className="text-white" strokeWidth={2.5} />
                        </div>
                        <div>
                            <h1 className="text-xl font-bold bg-gradient-to-r from-[#FF8081] to-[#ffb3b4] bg-clip-text text-transparent tracking-tight">
                                CMTI Bot
                            </h1>
                            <p className="text-xs text-gray-400 hidden sm:block">AI Assistant</p>
                        </div>
                    </div>

                    {/* Right - Actions */}
                    <div className="flex items-center gap-2">
                        {/* New Chat Button - Desktop */}
                        <button className="hidden md:flex items-center gap-2 px-4 py-2 bg-[#FF8081] hover:bg-[#ff6b6c] text-white text-sm font-medium rounded-lg transition-all duration-200 shadow-lg shadow-[#FF8081]/30">
                            <MessageSquare size={16} />
                            <span>New Chat</span>
                        </button>

                        {/* Clear Chat Button */}
                        <button
                            className="p-2 text-gray-400 hover:text-white hover:bg-[#2a2a2a] rounded-lg transition-all duration-200"
                            title="Clear chat"
                        >
                            <Trash2 size={20} />
                        </button>

                        {/* Theme Toggle */}
                        <button
                            onClick={() => setIsDark(!isDark)}
                            className="p-2 text-gray-400 hover:text-white hover:bg-[#2a2a2a] rounded-lg transition-all duration-200"
                            title="Toggle theme"
                        >
                            {isDark ? <Sun size={20} /> : <Moon size={20} />}
                        </button>

                        {/* Settings */}
                        <button
                            className="p-2 text-gray-400 hover:text-white hover:bg-[#2a2a2a] rounded-lg transition-all duration-200"
                            title="Settings"
                        >
                            <Settings size={20} />
                        </button>

                        {/* Mobile Menu Toggle */}
                        <button
                            onClick={() => setShowMenu(!showMenu)}
                            className="md:hidden p-2 text-gray-400 hover:text-white hover:bg-[#2a2a2a] rounded-lg transition-all duration-200"
                        >
                            {showMenu ? <X size={20} /> : <Menu size={20} />}
                        </button>
                    </div>
                </div>

                {/* Mobile Menu */}
                {showMenu && (
                    <div className="md:hidden border-t border-[#2a2a2a] py-3">
                        <button className="w-full flex items-center gap-3 px-4 py-3 text-white hover:bg-[#2a2a2a] rounded-lg transition-all duration-200">
                            <MessageSquare size={18} />
                            <span className="text-sm font-medium">New Chat</span>
                        </button>
                    </div>
                )}
            </div>
        </header>
    );
};

export default Header;