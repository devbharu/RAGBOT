import React from 'react';
import { CopyButton } from './ChatUtils';
import SyntaxHighlighter from 'react-syntax-highlighter';
import { vs2015 } from 'react-syntax-highlighter/dist/esm/styles/hljs';
import { X, Code } from 'lucide-react';

const LangBadge = ({ lang }) => {
  if (!lang) return null;
  return (
    <span className="px-2 py-0.5 rounded text-[10px] font-mono font-bold uppercase tracking-wider bg-[var(--bg-elevated)] border border-[var(--border-mid)] text-[var(--text-muted)]">
      {lang}
    </span>
  );
};

export const ArtifactPanel = React.memo(function ArtifactPanel({ artifact, onClose }) {
  if (!artifact) return null;

  return (
    <div className="flex flex-col border-l border-[var(--border)] bg-[var(--bg-surface)] h-full overflow-hidden min-w-[400px] max-w-[600px] w-[45%] animate-[fadeIn_0.3s_ease]">
      <div className="flex items-center justify-between px-4 py-3 border-b border-[var(--border)] bg-[var(--bg-panel)] shadow-sm">
        <div className="flex items-center gap-3">
          <div className="w-6 h-6 rounded flex items-center justify-center bg-[var(--accent-dim)] text-[var(--accent)] text-xs font-bold border border-[var(--accent)]/30">
            {`</>`}
          </div>
          <span className="text-[13px] font-mono font-semibold text-[var(--text-primary)]">
            Generated Code
          </span>
          <LangBadge lang={artifact.lang} />
        </div>
        <div className="flex items-center gap-2">
          <CopyButton text={artifact.code} />
          {onClose && (
              <button onClick={onClose} className="p-1.5 rounded-lg text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-elevated)] cursor-pointer transition-colors border-none bg-transparent">
                  <X size={14} />
              </button>
          )}
        </div>
      </div>
      
      <div className="flex-1 overflow-y-auto bg-[#1e1e1e]">
        <SyntaxHighlighter
          language={artifact.lang || 'javascript'}
          style={vs2015}
          customStyle={{
            margin: 0,
            padding: '24px 20px',
            fontSize: '13px',
            lineHeight: '1.6',
            fontFamily: "'JetBrains Mono', 'DM Mono', monospace",
            background: 'transparent'
          }}
          wrapLines={true}
          showLineNumbers={true}
          lineNumberStyle={{ minWidth: '2.5em', paddingRight: '1em', color: '#6e7681', textAlign: 'right' }}
        >
          {artifact.code || (artifact.open ? 'Generating...' : '')}
        </SyntaxHighlighter>
      </div>
    </div>
  );
});
