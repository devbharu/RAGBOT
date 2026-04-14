/**
 * ThemeContext.jsx — v7.0
 * Claude-like theme. Dark is genuinely readable. No gradients. Flat surfaces.
 */

/* eslint-disable react-refresh/only-export-components */
import { createContext, useContext, useState, useEffect } from "react";

const ThemeContext = createContext(null);

export const ThemeProvider = ({ children }) => {
    const [isDark, setIsDark] = useState(() => {
        try { return localStorage.getItem("cmti_theme") !== "light"; } catch { return true; }
    });

    const toggleTheme = () => setIsDark((d) => {
        const next = !d;
        try { localStorage.setItem("cmti_theme", next ? "dark" : "light"); } catch { return next; }
        return next;
    });

    useEffect(() => {
        const r = document.documentElement;
        if (isDark) {
            /* ── Dark: Claude-like, genuinely bright & readable ── */
            r.style.setProperty("--bg-base", "#1a1a20");
            r.style.setProperty("--bg-surface", "#1e1e25");
            r.style.setProperty("--bg-elevated", "#27272f");
            r.style.setProperty("--bg-panel", "#15151a");
            r.style.setProperty("--bg-input", "#23232c");

            r.style.setProperty("--border", "#2e2e3a");
            r.style.setProperty("--border-mid", "#3c3c4c");

            r.style.setProperty("--accent", "#e6c87a");
            r.style.setProperty("--accent-dim", "rgba(230,200,122,0.13)");
            r.style.setProperty("--accent-hover", "#f0d898");

            /* Text hierarchy — all clearly legible */
            r.style.setProperty("--text-primary", "#eeecea");
            r.style.setProperty("--text-body", "#cccac6");
            r.style.setProperty("--text-muted", "#94949f");
            r.style.setProperty("--text-faint", "#5e5e72");

            r.style.setProperty("--teal", "#5ec8c8");
            r.style.setProperty("--teal-dim", "rgba(94,200,200,0.10)");
            r.style.setProperty("--code-bg", "#12121a");
            r.style.setProperty("--user-bubble", "#25252f");
            r.style.setProperty("--scrollbar", "#3c3c4c");
        } else {
            /* ── Light: warm off-white, Claude.ai vibe ── */
            r.style.setProperty("--bg-base", "#f6f5f0");
            r.style.setProperty("--bg-surface", "#efede6");
            r.style.setProperty("--bg-elevated", "#e8e5dc");
            r.style.setProperty("--bg-panel", "#faf9f5");
            r.style.setProperty("--bg-input", "#ffffff");

            r.style.setProperty("--border", "#e0ddd4");
            r.style.setProperty("--border-mid", "#ccc9bc");

            r.style.setProperty("--accent", "#b8890a");
            r.style.setProperty("--accent-dim", "rgba(184,137,10,0.10)");
            r.style.setProperty("--accent-hover", "#9a7208");

            r.style.setProperty("--text-primary", "#1c1c18");
            r.style.setProperty("--text-body", "#3a3830");
            r.style.setProperty("--text-muted", "#78776a");
            r.style.setProperty("--text-faint", "#a8a898");

            r.style.setProperty("--teal", "#0e8a8a");
            r.style.setProperty("--teal-dim", "rgba(14,138,138,0.08)");
            r.style.setProperty("--code-bg", "#1a1a20");
            r.style.setProperty("--user-bubble", "#e6e3d8");
            r.style.setProperty("--scrollbar", "#ccc9bc");
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

// Export the context itself for direct use if needed
export { ThemeContext };