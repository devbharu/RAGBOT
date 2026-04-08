/**
 * ThemeContext.jsx — Global dark/light theme context
 * Import { useTheme, ThemeProvider } from this file
 */

import { createContext, useContext, useState, useEffect } from "react";

const ThemeContext = createContext(null);

export const ThemeProvider = ({ children }) => {
    const [isDark, setIsDark] = useState(() => {
        try { return localStorage.getItem("cmti_theme") !== "light"; } catch { return true; }
    });

    const toggleTheme = () => setIsDark((d) => {
        const next = !d;
        try { localStorage.setItem("cmti_theme", next ? "dark" : "light"); } catch { }
        return next;
    });

    // Inject CSS variables into :root based on theme
    useEffect(() => {
        const root = document.documentElement;
        if (isDark) {
            root.style.setProperty("--bg-base", "#0d0d12");
            root.style.setProperty("--bg-surface", "#0f0f18");
            root.style.setProperty("--bg-elevated", "#141420");
            root.style.setProperty("--bg-panel", "#0b0b0e");
            root.style.setProperty("--bg-input", "#13131e");
            root.style.setProperty("--border", "#1e1e2a");
            root.style.setProperty("--border-mid", "#252535");
            root.style.setProperty("--accent", "#e6c87a");
            root.style.setProperty("--accent-dim", "rgba(230,200,122,0.12)");
            root.style.setProperty("--accent-hover", "#f0d898");
            root.style.setProperty("--text-primary", "#f5f2ec");
            root.style.setProperty("--text-body", "#c8c6c0");
            root.style.setProperty("--text-muted", "#68687a");
            root.style.setProperty("--text-faint", "#404055");
            root.style.setProperty("--teal", "#5ec8c8");
            root.style.setProperty("--teal-dim", "rgba(94,200,200,0.08)");
            root.style.setProperty("--code-bg", "#1e1e1e");
            root.style.setProperty("--user-bubble", "#191928");
            root.style.setProperty("--scrollbar", "#252535");
        } else {
            root.style.setProperty("--bg-base", "#f5f4f0");
            root.style.setProperty("--bg-surface", "#eeece6");
            root.style.setProperty("--bg-elevated", "#e8e5dc");
            root.style.setProperty("--bg-panel", "#f9f8f4");
            root.style.setProperty("--bg-input", "#ffffff");
            root.style.setProperty("--border", "#d8d4c8");
            root.style.setProperty("--border-mid", "#c8c4b8");
            root.style.setProperty("--accent", "#b8890a");
            root.style.setProperty("--accent-dim", "rgba(184,137,10,0.10)");
            root.style.setProperty("--accent-hover", "#9a7208");
            root.style.setProperty("--text-primary", "#1a1a14");
            root.style.setProperty("--text-body", "#3a3830");
            root.style.setProperty("--text-muted", "#7a7868");
            root.style.setProperty("--text-faint", "#a8a898");
            root.style.setProperty("--teal", "#0e8a8a");
            root.style.setProperty("--teal-dim", "rgba(14,138,138,0.08)");
            root.style.setProperty("--code-bg", "#2b2b2b");
            root.style.setProperty("--user-bubble", "#e0ddd4");
            root.style.setProperty("--scrollbar", "#c8c4b8");
        }
    }, [isDark]);

    return (
        <ThemeContext.Provider value={{ isDark, toggleTheme }}>
            {children}
        </ThemeContext.Provider>
    );
};

export const useTheme = () => {
    const ctx = useContext(ThemeContext);
    if (!ctx) throw new Error("useTheme must be used inside ThemeProvider");
    return ctx;
};