/**
 * MainLayout.jsx — Layout wrapper with collapsible Sidebar
 * Components (Chatbot, ReportPanel) render their own headers
 */

import React from 'react';
import Sidebar from './Sidebar';

export default function MainLayout({ children }) {
    return (
        <div className="flex h-screen bg-white dark:bg-gray-950">
            {/* Sidebar - Always visible, toggles between icon/full view */}
            <Sidebar />

            {/* Main Content - rendered by child (Chatbot, ReportPanel, etc.) */}
            <main className="flex-1 flex flex-col overflow-hidden">
                {children}
            </main>
        </div>
    );
}
