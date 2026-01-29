import React from 'react';
import { Heart, Github, Twitter, Linkedin } from 'lucide-react';

const Footer = () => {
    return (
        <footer className="bg-[#1a1a1a] border-t border-[#2a2a2a] py-4">
            <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
                <div className="flex flex-col sm:flex-row items-center justify-between gap-3">
                    {/* Left - Copyright */}
                    <div className="flex items-center gap-2 text-sm text-gray-400">
                        <span>© 2024 CMTI Bot</span>
                        <span className="hidden sm:inline">•</span>
                        <span className="flex items-center gap-1">
                            Made with <Heart size={14} className="text-[#FF8081] fill-[#FF8081]" /> by CMTI
                        </span>
                    </div>

                    {/* Right - Links/Social */}
                    <div className="flex items-center gap-4">
                        <a
                            href="#"
                            className="text-gray-400 hover:text-[#FF8081] transition-colors duration-200"
                            title="Privacy Policy"
                        >
                            <span className="text-sm">Privacy</span>
                        </a>
                        <a
                            href="#"
                            className="text-gray-400 hover:text-[#FF8081] transition-colors duration-200"
                            title="Terms of Service"
                        >
                            <span className="text-sm">Terms</span>
                        </a>
                        <div className="flex items-center gap-2 ml-2">
                            <a
                                href="#"
                                className="p-1.5 text-gray-400 hover:text-[#FF8081] hover:bg-[#2a2a2a] rounded transition-all duration-200"
                                title="GitHub"
                            >
                                <Github size={16} />
                            </a>
                            <a
                                href="#"
                                className="p-1.5 text-gray-400 hover:text-[#FF8081] hover:bg-[#2a2a2a] rounded transition-all duration-200"
                                title="Twitter"
                            >
                                <Twitter size={16} />
                            </a>
                            <a
                                href="#"
                                className="p-1.5 text-gray-400 hover:text-[#FF8081] hover:bg-[#2a2a2a] rounded transition-all duration-200"
                                title="LinkedIn"
                            >
                                <Linkedin size={16} />
                            </a>
                        </div>
                    </div>
                </div>
            </div>
        </footer>
    );
};

export default Footer;