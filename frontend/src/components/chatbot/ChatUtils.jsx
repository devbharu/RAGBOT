import React, { useState, useEffect } from "react";
import { X, FileText, Copy, Check, Loader2, Sun, Moon } from "lucide-react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import rehypeKatex from "rehype-katex";
import rehypeRaw from "rehype-raw";
import "katex/dist/katex.min.css";
import { useTheme } from "../../context/ThemeContext";

export const PASTE_CARD_THRESHOLD = 300;

export function formatBytes(bytes) {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function isCodeLike(text) { return /[{};=><()[\]]/.test(text.slice(0, 300)); }

export const CopyButton = ({ text }) => {
    const [copied, setCopied] = useState(false);
    const handleCopy = async (e) => {
        e.stopPropagation();
        try { await navigator.clipboard.writeText(text); setCopied(true); setTimeout(() => setCopied(false), 2000); } catch { }
    };
    return (
        <button onClick={handleCopy} title="Copy"
            className={`flex items-center gap-1 px-2 py-1 rounded-lg text-[10px] font-mono border transition-all cursor-pointer ${copied
                ? "bg-[var(--accent-dim)] border-[var(--accent)]/40 text-[var(--accent)]"
                : "bg-transparent border-[var(--border-mid)] text-[var(--text-faint)] hover:text-[var(--text-muted)] hover:bg-[var(--bg-elevated)]"}`}>
            {copied ? <Check size={10} /> : <Copy size={10} />}
            {copied ? "Copied" : "Copy"}
        </button>
    );
};

export const PasteModal = ({ card, onClose }) => {
    const lines = card.content.split("\n");
    const bytes = new TextEncoder().encode(card.content).length;
    useEffect(() => {
        const handler = (e) => { if (e.key === "Escape") onClose(); };
        document.addEventListener("keydown", handler);
        return () => document.removeEventListener("keydown", handler);
    }, [onClose]);
    return (
        <div className="fixed inset-0 z-[300] flex items-center justify-center backdrop-blur-sm" style={{ background: "var(--overlay-bg)" }} onClick={onClose}>
            <div className="relative w-full max-w-2xl mx-4 flex flex-col rounded-2xl overflow-hidden shadow-2xl"
                style={{ background: "var(--bg-panel)", border: "1px solid var(--border-mid)", maxHeight: "80vh" }}
                onClick={e => e.stopPropagation()}>
                <div className="flex items-start justify-between px-6 py-4 flex-shrink-0" style={{ borderBottom: "1px solid var(--border)" }}>
                    <div>
                        <h2 className="text-[15px] font-medium text-[var(--text-primary)] m-0" style={{ fontFamily: "'Fraunces', serif", fontStyle: "italic" }}>Pasted content</h2>
                        <div className="flex items-center gap-2 mt-1 text-[11px] text-[var(--text-faint)] font-mono">
                            <span>{formatBytes(bytes)}</span>
                            <span className="w-1 h-1 rounded-full bg-[var(--text-faint)] inline-block" />
                            <span>{lines.length} lines</span>
                        </div>
                    </div>
                    <div className="flex items-center gap-2 flex-shrink-0 ml-4">
                        <CopyButton text={card.content} />
                        <button onClick={onClose} className="p-1.5 rounded-lg bg-transparent border border-[var(--border-mid)] cursor-pointer text-[var(--text-faint)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-elevated)] transition-all"><X size={14} /></button>
                    </div>
                </div>
                <div className="flex-1 overflow-auto" style={{ background: "var(--bg-base)" }}>
                    <div className="px-4 py-4 font-mono text-[12.5px] leading-[1.75]">
                        {lines.map((line, i) => (
                            <div key={i} className="flex gap-4 group hover:bg-[var(--accent-dim)]/40 rounded px-2 -mx-2 transition-colors">
                                <span className="select-none text-[var(--text-faint)] w-8 text-right flex-shrink-0 leading-[1.75] text-[11px]">{i + 1}</span>
                                <span className="flex-1 text-[var(--text-body)] break-all whitespace-pre-wrap">{line || "\u00A0"}</span>
                            </div>
                        ))}
                    </div>
                </div>
            </div>
        </div>
    );
};

export const PasteChip = ({ card, onRemove, onClick }) => {
    const lines = card.content.split("\n").length;
    const bytes = new TextEncoder().encode(card.content).length;
    return (
        <div className="inline-flex items-center gap-1.5 mr-1.5 mb-1.5 pl-2.5 pr-1 py-1 rounded-xl border border-[var(--border-mid)] bg-[var(--bg-elevated)] cursor-pointer transition-all hover:border-[var(--accent)]/40 hover:bg-[var(--accent-dim)]" onClick={onClick}>
            <FileText size={11} className="text-[var(--accent)] flex-shrink-0" />
            <span className="text-[11px] font-mono text-[var(--text-primary)]">{isCodeLike(card.content) ? "Code" : "Text"}</span>
            <span className="text-[10px] font-mono text-[var(--text-faint)]">{lines}L · {formatBytes(bytes)}</span>
            <button onClick={e => { e.stopPropagation(); onRemove(card.id); }} className="ml-0.5 p-0.5 rounded-md bg-transparent border-none cursor-pointer text-[var(--text-faint)] hover:text-[var(--red-soft)] transition-colors"><X size={10} /></button>
        </div>
    );
};

function normaliseContent(text) {
    if (!text) return "";
    text = text.replace(/\\\[([\s\S]*?)\\\]/g, (_, i) => `\n$$${i}$$\n`);
    text = text.replace(/\\\(([\s\S]*?)\\\)/g, (_, i) => `$${i}$`);
    text = text.replace(/(\$[^$\n]+?\$)\s*\1/g, "$1");
    text = text.replace(/<br\s*\/?>/gi, " · ");
    // Convert [p. 3], (p.3), p.3 into markdown links if not already in a link
    text = text.replace(/(?:\[|\()?p\.\s*(\d+)(?:\]|\))?/gi, (match, page, offset, string) => {
        if (string.slice(offset + match.length).startsWith("](#")) return match;
        return `[p.${page}](#page-${page})`;
    });
    return text;
}

export const MarkdownMessage = React.memo(({ content, onCitationClick }) => (
    <div className="text-[15px] leading-relaxed text-[var(--text-body)] max-w-full overflow-hidden markdown-body">
        <ReactMarkdown
            remarkPlugins={[remarkGfm, remarkMath]}
            rehypePlugins={[rehypeRaw, [rehypeKatex, { strict: false, throwOnError: false }]]}
            components={{
            table: ({ ...props }) => <div className="overflow-x-auto my-3 rounded-lg border border-[var(--border-mid)] w-full"><table className="border-collapse text-[12.5px] w-full font-mono" style={{ tableLayout: "fixed", wordBreak: "break-word" }} {...props} /></div>,
            thead: ({ ...props }) => <thead className="bg-[var(--bg-elevated)]" {...props} />,
            th: ({ ...props }) => <th className="border-none border-b border-[var(--border-mid)] px-3.5 py-2.5 text-left font-semibold text-[var(--text-primary)] text-[10.5px] tracking-widest uppercase" {...props} />,
            td: ({ ...props }) => <td className="border-none border-b border-[var(--border)] px-3.5 py-2 text-[var(--text-body)] text-[12.5px] leading-relaxed align-top" style={{ wordBreak: "break-word" }} {...props} />,
            tr: ({ ...props }) => <tr className="transition-colors hover:bg-[var(--accent-dim)]" {...props} />,
            pre: ({ children, ...props }) => (
                <pre className="bg-[var(--code-bg)] border border-[var(--border)] rounded-lg px-4 py-3.5 overflow-x-auto my-3" {...props}>
                    {children}
                </pre>
            ),
            code: ({ className, children, node, ...props }) => {
                const match = /language-(\w+)/.exec(className || '');
                const isBlock = match || String(children).includes('\n');
                return isBlock ? (
                    <code className={`text-[var(--code-text)] text-[0.8em] font-mono leading-7 ${className || ""}`} {...props}>{children}</code>
                ) : (
                    <code className="bg-[var(--accent-dim)] px-1.5 py-0.5 rounded text-[var(--accent)] text-[0.84em] font-mono break-words" {...props}>{children}</code>
                );
            },
            h1: ({ ...props }) => <h1 className="text-lg font-light text-[var(--text-primary)] mt-4 mb-1" style={{ fontFamily: "'Fraunces', serif", fontStyle: "italic" }} {...props} />,
            h2: ({ ...props }) => <h2 className="text-sm font-normal text-[var(--text-primary)] mt-3 mb-1" style={{ fontFamily: "'Fraunces', serif", fontStyle: "italic" }} {...props} />,
            h3: ({ ...props }) => <h3 className="text-[12.5px] font-semibold text-[var(--text-body)] mt-3 mb-1 font-mono tracking-widest uppercase" {...props} />,
            ul: ({ ...props }) => <ul className="pl-4 my-2 flex flex-col gap-1" {...props} />,
            ol: ({ ...props }) => <ol className="pl-4 my-2 flex flex-col gap-1" {...props} />,
            li: ({ ...props }) => <li className="text-[var(--text-body)] leading-7 text-[15px]" {...props} />,
            p: ({ ...props }) => <p className="mb-2.5 text-[var(--text-body)] leading-relaxed text-[15px]" {...props} />,
            strong: ({ ...props }) => <strong className="font-bold text-[var(--text-primary)]" {...props} />,
            blockquote: ({ ...props }) => <blockquote className="border-l-2 border-[var(--accent)] ml-0 text-[var(--text-muted)] italic bg-[var(--accent-dim)] rounded-r-lg px-3.5 py-2.5 my-3" {...props} />,
            a: ({ href, children, ...props }) => {
                if (href && href.startsWith("#page-")) {
                    const page = parseInt(href.replace("#page-", ""), 10);
                    return <button onClick={() => onCitationClick && onCitationClick(page)} className="text-[var(--accent)] bg-[var(--accent-dim)] hover:bg-[var(--accent)] hover:text-white px-1.5 py-0.5 rounded text-xs font-semibold cursor-pointer border-none transition-colors duration-200" title={`Jump to page ${page}`}>{children}</button>;
                }
                return <a href={href} className="text-[var(--accent)] underline underline-offset-2" target="_blank" rel="noopener noreferrer" {...props}>{children}</a>;
            }
        }}
    >{normaliseContent(content)}</ReactMarkdown>
    </div>
));

export const ThinkBlock = ({ thinking, done }) => {
    const [open, setOpen] = useState(false);
    const secs = Math.max(1, Math.round(thinking.length / 200));
    return (
        <div className="mb-2.5">
            <button onClick={() => setOpen(o => !o)} className={`flex items-center gap-1.5 bg-transparent border-none cursor-pointer p-0 text-[11px] font-mono tracking-wide ${done ? "text-[var(--text-faint)]" : "text-[var(--accent)]/70"}`}>
                {!done ? <Loader2 size={11} className="animate-spin text-[var(--accent)]" /> : <span className="text-[10px]">{open ? "▲" : "▼"}</span>}
                {done ? `Thought for ${secs}s` : "Thinking…"}
            </button>
            {open && <div className="mt-1.5 px-3.5 py-2.5 bg-[var(--bg-base)] border border-[var(--border)] rounded-lg text-[11.5px] text-[var(--text-muted)] font-mono leading-7 whitespace-pre-wrap">{thinking}</div>}
        </div>
    );
};

export const TypingDots = () => (
    <div className="flex gap-1.5 items-center py-1">
        {[0, 140, 280].map((delay, i) => <span key={i} className="w-1.5 h-1.5 rounded-full bg-[var(--text-faint)] block animate-[bounce_1.2s_ease-in-out_infinite]" style={{ animationDelay: `${delay}ms` }} />)}
    </div>
);

export const SuggestedQuestions = ({ file, onSelect }) => {
    if (!file) return null;
    const prompts = ["Summarize this document", "What are the key findings?", "List all tables and figures", "What are the main conclusions?"];
    return (
        <div className="flex flex-wrap gap-2 justify-center max-w-lg">
            {prompts.map(p => (
                <button key={p} onClick={() => onSelect(p)} className="px-4 py-2 rounded-xl bg-[var(--bg-elevated)] border border-[var(--border-mid)] text-[var(--text-body)] text-xs cursor-pointer font-mono tracking-wide transition-all hover:border-[var(--accent)]/40 hover:text-[var(--accent)] hover:bg-[var(--accent-dim)]">{p}</button>
            ))}
        </div>
    );
};

export const ThemeToggle = () => {
    const { isDark, toggleTheme } = useTheme();
    return (
        <button onClick={toggleTheme} title={isDark ? "Light mode" : "Dark mode"} className="p-2 rounded-lg bg-transparent border border-[var(--border-mid)] text-[var(--text-muted)] cursor-pointer transition-all hover:bg-[var(--bg-elevated)] hover:text-[var(--text-body)]">
            {isDark ? <Sun size={14} /> : <Moon size={14} />}
        </button>
    );
};
