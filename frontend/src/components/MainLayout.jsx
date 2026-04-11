/**
 * MainLayout.jsx — CMTI v8.0
 * Sidebar + main content shell.
 * Colors come entirely from ThemeContext CSS vars — zero hardcoded values.
 */

import React from 'react';
import Sidebar from './Sidebar';

export default function MainLayout({ children }) {
    return (
        <div
            style={{
                display: 'flex',
                height: '100vh',
                overflow: 'hidden',
                background: 'var(--bg-surface)',
                color: 'var(--text-body)',
            }}
        >
            <Sidebar />
            <main
                style={{
                    flex: 1,
                    display: 'flex',
                    flexDirection: 'column',
                    overflow: 'hidden',
                    minWidth: 0, /* prevent flex blowout */
                }}
            >
                {children}
            </main>
        </div>
    );
}