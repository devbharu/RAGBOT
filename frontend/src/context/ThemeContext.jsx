/**
 * ThemeContext — design tokens for light & dark (eye-comfort first in light mode).
 * Principles: warm neutrals, no pure white/black, soft contrast, semantic tokens only.
 */

/* eslint-disable react-refresh/only-export-components */
import { createContext, useContext, useState, useEffect } from "react";

const ThemeContext = createContext(null);

/** @param {HTMLElement} root @param {Record<string, string>} tokens */
function applyTokens(root, tokens) {
    for (const [key, value] of Object.entries(tokens)) {
        root.style.setProperty(key, value);
    }
}

const DARK_TOKENS = {
    "--bg-base": "#1a1a20",
    "--bg-surface": "#1e1e25",
    "--bg-elevated": "#27272f",
    "--bg-panel": "#15151a",
    "--bg-input": "#23232c",

    "--border": "#2e2e3a",
    "--border-mid": "#3c3c4c",
    "--border-soft": "#252530",

    "--accent": "#e6c87a",
    "--accent-dim": "rgba(230, 200, 122, 0.13)",
    "--accent-hover": "#f0d898",
    "--on-accent": "#1a1a20",

    "--brand": "#7ba3c4",
    "--brand-dim": "rgba(123, 163, 196, 0.12)",
    "--brand-border": "rgba(123, 163, 196, 0.28)",
    "--on-brand": "#0f1418",

    "--text-primary": "#eeecea",
    "--text-body": "#cccac6",
    "--text-muted": "#94949f",
    "--text-faint": "#5e5e72",

    "--teal": "#5ec8c8",
    "--teal-dim": "rgba(94, 200, 200, 0.10)",

    "--code-bg": "#12121a",
    "--code-text": "#d4d4cc",
    "--user-bubble": "#25252f",
    "--assistant-surface": "#1e1e25",
    "--scrollbar": "#3c3c4c",

    "--shadow-sm": "0 1px 2px rgba(0, 0, 0, 0.2)",
    "--shadow-md": "0 4px 16px rgba(0, 0, 0, 0.28)",
    "--shadow-lg": "0 8px 40px rgba(0, 0, 0, 0.45)",
    "--shadow-panel": "0 1px 3px rgba(0, 0, 0, 0.22)",
    "--focus-ring": "rgba(230, 200, 122, 0.4)",

    "--glass-bg": "rgba(21, 21, 26, 0.82)",
    "--glass-border": "#2e2e3a",
    "--overlay-bg": "rgba(0, 0, 0, 0.55)",

    "--ed-bg": "#12121a",
    "--ed-gutter": "#0d0d14",
    "--ed-bar": "#191920",

    "--green-vivid": "#4ade80",
    "--green-dim": "rgba(74, 222, 128, 0.08)",
    "--green-border": "rgba(74, 222, 128, 0.25)",

    "--red-soft": "#f87171",
    "--red-dim": "rgba(248, 113, 113, 0.06)",
    "--red-border": "rgba(248, 113, 113, 0.2)",

    "--warn": "#b8b040",
    "--warn-dim": "rgba(160, 160, 60, 0.08)",
    "--warn-border": "rgba(160, 160, 60, 0.2)",

    "--multi-accent": "#a78bfa",
    "--multi-text": "#c4b5fd",
    "--multi-dim": "rgba(139, 92, 246, 0.15)",
    "--multi-dim-hover": "rgba(139, 92, 246, 0.12)",
    "--multi-dim-soft": "rgba(139, 92, 246, 0.07)",
    "--multi-border": "rgba(139, 92, 246, 0.35)",
    "--multi-chip-bg": "rgba(139, 92, 246, 0.1)",
    "--multi-chip-border": "rgba(139, 92, 246, 0.3)",
    "--multi-btn-bg": "rgba(139, 92, 246, 0.1)",
    "--multi-btn-border": "rgba(139, 92, 246, 0.4)",
    "--on-multi": "#09090c",

    "--latex-default": "#d4d4cc",
    "--latex-comment": "#6a9955",
    "--latex-command": "#7cb8f8",
    "--latex-brace": "#e6c87a",
    "--latex-math": "#4ec9b0",
    "--latex-string": "#ce9178",
    "--latex-special": "#dcdcaa",
    "--pdf-shadow": "0 4px 32px rgba(0, 0, 0, 0.22)",

    /* ── Apple HIG / Liquid Glass additions (dark) ── */

    /* Type scale */
    "--fs-code": "13px",
    "--fs-ui": "15px",
    "--fs-label": "11px",
    "--fw-label": "600",
    "--ls-label": "0.08em",
    "--font-ui": "system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif",
    "--font-mono": "'SF Mono', 'Segoe UI Mono', 'Roboto Mono', Menlo, Monaco, Consolas, 'Courier New', monospace",

    /* Toolbar — floats above content */
    "--toolbar-bg": "rgba(18, 18, 26, 0.72)",
    "--toolbar-border": "rgba(255, 255, 255, 0.06)",
    "--toolbar-shadow": "0 1px 0 rgba(255,255,255,0.04), 0 4px 24px rgba(0,0,0,0.55)",
    "--toolbar-blur": "saturate(180%) blur(20px)",

    /* Panel glass — side panels recede behind content */
    "--panel-glass-bg": "rgba(15, 15, 20, 0.70)",
    "--panel-glass-border": "rgba(255, 255, 255, 0.05)",
    "--panel-glass-highlight": "rgba(255, 255, 255, 0.03)",
    "--panel-blur": "saturate(160%) blur(16px)",

    /* Active tab — raised glass pill */
    "--tab-active-bg": "rgba(255, 255, 255, 0.10)",
    "--tab-active-border": "rgba(255, 255, 255, 0.14)",
    "--tab-active-shadow": "0 1px 3px rgba(0,0,0,0.4), inset 0 1px 0 rgba(255,255,255,0.08)",
    "--tab-inactive-bg": "transparent",

    /* Segmented control (Retrieval Approach toggle) */
    "--seg-track-bg": "rgba(255, 255, 255, 0.06)",
    "--seg-track-border": "rgba(255, 255, 255, 0.09)",
    "--seg-thumb-bg": "rgba(255, 255, 255, 0.13)",
    "--seg-thumb-border": "rgba(255, 255, 255, 0.18)",
    "--seg-thumb-shadow": "0 1px 4px rgba(0,0,0,0.5), inset 0 1px 0 rgba(255,255,255,0.10)",
    "--seg-text-active": "#eeecea",
    "--seg-text-inactive": "#94949f",

    /* Button hierarchy */
    "--btn-primary-bg": "#e6c87a",
    "--btn-primary-text": "#1a1a20",
    "--btn-primary-shadow": "0 1px 2px rgba(0,0,0,0.3), 0 0 0 1px rgba(230,200,122,0.25)",
    "--btn-primary-hover-bg": "#f0d898",

    "--btn-secondary-bg": "rgba(255, 255, 255, 0.07)",
    "--btn-secondary-border": "rgba(255, 255, 255, 0.13)",
    "--btn-secondary-text": "#cccac6",
    "--btn-secondary-hover-bg": "rgba(255, 255, 255, 0.12)",
    "--btn-secondary-shadow": "0 1px 2px rgba(0,0,0,0.25), inset 0 1px 0 rgba(255,255,255,0.06)",

    "--btn-tertiary-text": "#94949f",
    "--btn-tertiary-hover-text": "#eeecea",
    "--btn-tertiary-hover-bg": "rgba(255, 255, 255, 0.06)",

    /* Outline tree */
    "--tree-hover-bg": "rgba(255, 255, 255, 0.05)",
    "--tree-active-bar": "#e6c87a",
    "--tree-active-bg": "rgba(230, 200, 122, 0.09)",
    "--tree-active-text": "#f0d898",
    "--tree-indent-line": "rgba(255, 255, 255, 0.07)",

    /* Focus hint input */
    "--input-focus-ring": "0 0 0 2px rgba(230, 200, 122, 0.45)",
    "--input-placeholder": "#5e5e72",

    /* Stepper (pipeline log) */
    "--step-done-bg": "#4ade80",
    "--step-done-border": "rgba(74, 222, 128, 0.4)",
    "--step-done-text": "#0a1a10",
    "--step-active-ring": "rgba(230, 200, 122, 0.55)",
    "--step-active-bg": "#e6c87a",
    "--step-active-text": "#1a1a20",
    "--step-pending-bg": "transparent",
    "--step-pending-border": "rgba(255, 255, 255, 0.14)",
    "--step-pending-text": "#5e5e72",
    "--step-connector": "rgba(255, 255, 255, 0.10)",
    "--step-connector-done": "rgba(74, 222, 128, 0.35)",

    /* Empty PDF state */
    "--empty-icon-color": "#3c3c4c",
    "--empty-text-primary": "#94949f",
    "--empty-text-sub": "#5e5e72",

    /* Z-layer elevation shadows */
    "--z-toolbar-shadow": "0 2px 0 rgba(255,255,255,0.03), 0 8px 32px rgba(0,0,0,0.6)",
    "--z-panel-shadow": "1px 0 0 rgba(255,255,255,0.04), inset -1px 0 0 rgba(0,0,0,0.2)",
    "--z-editor-shadow": "inset 0 1px 0 rgba(255,255,255,0.03)",
    "--z-pdf-shadow": "0 8px 48px rgba(0,0,0,0.55)",

    /* Section header style */
    "--section-header-color": "#5e5e72",
    "--section-header-weight": "600",
    "--section-header-spacing": "0.10em",
};

/** Light: warm paper tones, Claude-like aesthetic, deep earthy contrast (Glare reduced) */
const LIGHT_TOKENS = {
    "--bg-base": "#f2efe8", // Softer, deeper warm paper to reduce glare
    "--bg-surface": "#ebe8df", // Slightly deeper paper
    "--bg-elevated": "#e5e2d8", // Even deeper for panels
    "--bg-panel": "#f7f5ef", // Soft off-white instead of pure white
    "--bg-input": "#fbfaf7", // Slightly muted input background

    "--border": "#e1ded5", // Sand border
    "--border-mid": "#d5d2c8",
    "--border-soft": "#e8e5dc",

    "--accent": "#d97757", // Claude coral/terracotta
    "--accent-dim": "rgba(217, 119, 87, 0.12)",
    "--accent-hover": "#c26345",
    "--on-accent": "#ffffff",

    "--brand": "#d97757",
    "--brand-dim": "rgba(217, 119, 87, 0.1)",
    "--brand-border": "rgba(217, 119, 87, 0.2)",
    "--on-brand": "#ffffff",

    "--text-primary": "#2d2926", // Deep earthy charcoal
    "--text-body": "#4a4642", // Warm gray body text
    "--text-muted": "#7a756f", // Stone gray
    "--text-faint": "#a8a49e",

    "--teal": "#0f766e",
    "--teal-dim": "rgba(15, 118, 110, 0.1)",

    "--code-bg": "#ebe8df", // Matching surface
    "--code-text": "#3a3632",
    "--user-bubble": "#e3e0d6", // Slightly deeper sand for user bubble
    "--assistant-surface": "#f7f5ef",
    "--scrollbar": "#d5d2c8",

    "--shadow-sm": "0 1px 2px rgba(45, 41, 38, 0.04)",
    "--shadow-md": "0 4px 12px rgba(45, 41, 38, 0.06)",
    "--shadow-lg": "0 8px 30px rgba(45, 41, 38, 0.08)",
    "--shadow-panel": "0 1px 3px rgba(45, 41, 38, 0.05)",

    "--focus-ring": "rgba(217, 119, 87, 0.35)",

    "--glass-bg": "rgba(242, 239, 232, 0.85)", // Warm glass
    "--glass-border": "#e1ded5",
    "--overlay-bg": "rgba(45, 41, 38, 0.15)", // Earthy overlay

    "--ed-bg": "#fbfaf7",
    "--ed-gutter": "#f2efe8",
    "--ed-bar": "#ebe8df",

    "--green-vivid": "#16a34a",
    "--green-dim": "rgba(22, 163, 74, 0.1)",
    "--green-border": "rgba(22, 163, 74, 0.2)",

    "--red-soft": "#ef4444",
    "--red-dim": "rgba(239, 68, 68, 0.1)",
    "--red-border": "rgba(239, 68, 68, 0.2)",

    "--warn": "#d97706",
    "--warn-dim": "rgba(217, 119, 6, 0.1)",
    "--warn-border": "rgba(217, 119, 6, 0.2)",

    "--multi-accent": "#d97757",
    "--multi-text": "#c26345",
    "--multi-dim": "rgba(217, 119, 87, 0.1)",
    "--multi-dim-hover": "rgba(217, 119, 87, 0.12)",
    "--multi-dim-soft": "rgba(217, 119, 87, 0.06)",
    "--multi-border": "rgba(217, 119, 87, 0.25)",
    "--multi-chip-bg": "rgba(217, 119, 87, 0.08)",
    "--multi-chip-border": "rgba(217, 119, 87, 0.2)",
    "--multi-btn-bg": "rgba(217, 119, 87, 0.08)",
    "--multi-btn-border": "rgba(217, 119, 87, 0.3)",
    "--on-multi": "#ffffff",

    "--latex-default": "#2d2926",
    "--latex-comment": "#16a34a",
    "--latex-command": "#2563eb",
    "--latex-brace": "#d97706",
    "--latex-math": "#0f766e",
    "--latex-string": "#c26345",
    "--latex-special": "#7c3aed",
    "--pdf-shadow": "0 8px 32px rgba(45, 41, 38, 0.1)",

    /* ── Apple HIG / Liquid Glass additions (light) ── */

    /* Type scale (shared across themes — identical values) */
    "--fs-code": "13px",
    "--fs-ui": "15px",
    "--fs-label": "11px",
    "--fw-label": "600",
    "--ls-label": "0.08em",
    "--font-ui": "system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif",
    "--font-mono": "'SF Mono', 'Segoe UI Mono', 'Roboto Mono', Menlo, Monaco, Consolas, 'Courier New', monospace",

    /* Toolbar */
    "--toolbar-bg": "rgba(242, 239, 232, 0.80)",
    "--toolbar-border": "rgba(45, 41, 38, 0.08)",
    "--toolbar-shadow": "0 1px 0 rgba(255,255,255,0.7), 0 4px 20px rgba(45,41,38,0.08)",
    "--toolbar-blur": "saturate(180%) blur(20px)",

    /* Panel glass */
    "--panel-glass-bg": "rgba(235, 232, 223, 0.82)",
    "--panel-glass-border": "rgba(45, 41, 38, 0.06)",
    "--panel-glass-highlight": "rgba(255, 255, 255, 0.55)",
    "--panel-blur": "saturate(160%) blur(16px)",

    /* Active tab */
    "--tab-active-bg": "rgba(255, 255, 255, 0.65)",
    "--tab-active-border": "rgba(45, 41, 38, 0.10)",
    "--tab-active-shadow": "0 1px 4px rgba(45,41,38,0.12), inset 0 1px 0 rgba(255,255,255,0.9)",
    "--tab-inactive-bg": "transparent",

    /* Segmented control */
    "--seg-track-bg": "rgba(45, 41, 38, 0.06)",
    "--seg-track-border": "rgba(45, 41, 38, 0.08)",
    "--seg-thumb-bg": "rgba(255, 255, 255, 0.80)",
    "--seg-thumb-border": "rgba(45, 41, 38, 0.10)",
    "--seg-thumb-shadow": "0 1px 4px rgba(45,41,38,0.15), inset 0 1px 0 rgba(255,255,255,1)",
    "--seg-text-active": "#2d2926",
    "--seg-text-inactive": "#7a756f",

    /* Button hierarchy */
    "--btn-primary-bg": "#d97757",
    "--btn-primary-text": "#ffffff",
    "--btn-primary-shadow": "0 1px 2px rgba(45,41,38,0.2), 0 0 0 1px rgba(217,119,87,0.3)",
    "--btn-primary-hover-bg": "#c26345",

    "--btn-secondary-bg": "rgba(45, 41, 38, 0.06)",
    "--btn-secondary-border": "rgba(45, 41, 38, 0.12)",
    "--btn-secondary-text": "#4a4642",
    "--btn-secondary-hover-bg": "rgba(45, 41, 38, 0.10)",
    "--btn-secondary-shadow": "0 1px 2px rgba(45,41,38,0.08), inset 0 1px 0 rgba(255,255,255,0.8)",

    "--btn-tertiary-text": "#7a756f",
    "--btn-tertiary-hover-text": "#2d2926",
    "--btn-tertiary-hover-bg": "rgba(45, 41, 38, 0.05)",

    /* Outline tree */
    "--tree-hover-bg": "rgba(45, 41, 38, 0.04)",
    "--tree-active-bar": "#d97757",
    "--tree-active-bg": "rgba(217, 119, 87, 0.08)",
    "--tree-active-text": "#c26345",
    "--tree-indent-line": "rgba(45, 41, 38, 0.08)",

    /* Focus hint input */
    "--input-focus-ring": "0 0 0 2px rgba(217, 119, 87, 0.40)",
    "--input-placeholder": "#a8a49e",

    /* Stepper */
    "--step-done-bg": "#16a34a",
    "--step-done-border": "rgba(22, 163, 74, 0.3)",
    "--step-done-text": "#ffffff",
    "--step-active-ring": "rgba(217, 119, 87, 0.45)",
    "--step-active-bg": "#d97757",
    "--step-active-text": "#ffffff",
    "--step-pending-bg": "transparent",
    "--step-pending-border": "rgba(45, 41, 38, 0.18)",
    "--step-pending-text": "#a8a49e",
    "--step-connector": "rgba(45, 41, 38, 0.12)",
    "--step-connector-done": "rgba(22, 163, 74, 0.30)",

    /* Empty PDF state */
    "--empty-icon-color": "#dcdad1",
    "--empty-text-primary": "#7a756f",
    "--empty-text-sub": "#a8a49e",

    /* Z-layer elevation shadows */
    "--z-toolbar-shadow": "0 1px 0 rgba(255,255,255,0.8), 0 4px 20px rgba(45,41,38,0.10)",
    "--z-panel-shadow": "1px 0 0 rgba(45,41,38,0.06), inset -1px 0 0 rgba(255,255,255,0.4)",
    "--z-editor-shadow": "inset 0 1px 0 rgba(45,41,38,0.04)",
    "--z-pdf-shadow": "0 8px 40px rgba(45,41,38,0.12)",

    /* Section header style */
    "--section-header-color": "#a8a49e",
    "--section-header-weight": "600",
    "--section-header-spacing": "0.10em",
};

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
        const root = document.documentElement;
        root.classList.toggle("dark", isDark);
        root.classList.toggle("theme-dark", isDark);
        root.classList.toggle("theme-light", !isDark);
        root.style.colorScheme = isDark ? "dark" : "light";
        applyTokens(root, isDark ? DARK_TOKENS : LIGHT_TOKENS);
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

export { ThemeContext };
