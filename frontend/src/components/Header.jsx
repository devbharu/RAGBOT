import React from 'react';
import { Sun, Moon, MessageSquare } from 'lucide-react';
import { useTheme } from '../context/ThemeContext';

const Header = () => {
    const { isDark, toggleTheme } = useTheme();

    return (
        <header className="sticky top-0 z-40 backdrop-blur-sm border-b border-[var(--border)] bg-[var(--bg-panel)]">
            <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
                <div className="flex items-center justify-between h-16">
                    <div className="flex items-center gap-3">
                        <div className="w-9 h-9 rounded-xl flex items-center justify-center shadow-[var(--shadow-sm)]" style={{ background: "var(--accent)", color: "var(--on-accent)" }}>
                            <MessageSquare size={20} strokeWidth={2.5} />
                        </div>
                        <div>
                            <h1 className="text-xl font-bold tracking-tight text-[var(--accent)]" style={{ fontFamily: "'Fraunces', serif" }}>
                                CMTI Bot
                            </h1>
                            <p className="text-xs text-[var(--text-muted)] hidden sm:block">AI Assistant</p>
                        </div>
                    </div>

                    <div className="flex items-center gap-2">
                        <button
                            onClick={toggleTheme}
                            className="p-2 text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-elevated)] rounded-lg transition-all duration-200 border border-transparent hover:border-[var(--border-mid)]"
                            title={isDark ? "Light mode" : "Dark mode"}
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
