import React from 'react';
import { Sun, Moon, MessageSquare } from 'lucide-react';
import { useTheme } from '../context/ThemeContext';

const Header = () => {
    const { isDark, toggleTheme } = useTheme();

    return (
        <header className="bg-white dark:bg-[#1a1a1a] border-b border-gray-200 dark:border-[#2a2a2a] sticky top-0 z-40 backdrop-blur-sm">
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
                            <p className="text-xs text-gray-500 dark:text-gray-400 hidden sm:block">AI Assistant</p>
                        </div>
                    </div>

                    {/* Right - Actions */}
                    <div className="flex items-center gap-2">
                        {/* New Chat Button - Desktop */}
                        <button className="hidden md:flex items-center gap-2 px-4 py-2 bg-[#FF8081] hover:bg-[#ff6b6c] text-white text-sm font-medium rounded-lg transition-all duration-200 shadow-lg shadow-[#FF8081]/30">
                            <MessageSquare size={16} />
                            <span>New Chat</span>
                        </button>

                        {/* Theme Toggle */}
                        <button
                            onClick={toggleTheme}
                            className="p-2 text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white hover:bg-gray-100 dark:hover:bg-[#2a2a2a] rounded-lg transition-all duration-200"
                            title="Toggle theme"
                        >
                            {isDark ? <Sun size={20} /> : <Moon size={20} />}
                        </button>
                    </div>
                </div>
            </div>
        </header>
    );
};

export default Header;
