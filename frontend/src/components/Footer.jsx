import React from 'react';
import { Heart, Github, Twitter, Linkedin } from 'lucide-react';

const Footer = () => {
    return (
        <footer className="border-t border-[var(--border)] py-4 bg-[var(--bg-panel)]">
            <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
                <div className="flex flex-col sm:flex-row items-center justify-between gap-3">
                    <div className="flex items-center gap-2 text-sm text-[var(--text-muted)]">
                        <span>© 2024 CMTI Bot</span>
                        <span className="hidden sm:inline">•</span>
                        <span className="flex items-center gap-1">
                            Made with <Heart size={14} className="text-[var(--accent)] fill-[var(--accent)]" /> by CMTI
                        </span>
                    </div>

                    <div className="flex items-center gap-4">
                        <a href="#" className="text-[var(--text-muted)] hover:text-[var(--accent)] transition-colors duration-200" title="Privacy Policy">
                            <span className="text-sm">Privacy</span>
                        </a>
                        <a href="#" className="text-[var(--text-muted)] hover:text-[var(--accent)] transition-colors duration-200" title="Terms of Service">
                            <span className="text-sm">Terms</span>
                        </a>
                        <div className="flex items-center gap-2 ml-2">
                            {[Github, Twitter, Linkedin].map((Icon, i) => (
                                <a
                                    key={i}
                                    href="#"
                                    className="p-1.5 text-[var(--text-muted)] hover:text-[var(--accent)] hover:bg-[var(--bg-elevated)] rounded transition-all duration-200"
                                >
                                    <Icon size={16} />
                                </a>
                            ))}
                        </div>
                    </div>
                </div>
            </div>
        </footer>
    );
};

export default Footer;
