// src/components/chatbot/StepsSidebar.jsx
import React, { useState, useEffect } from 'react';
import { ChevronDown, ChevronRight, CheckCircle2, Loader2, FileText } from 'lucide-react';

const getShortName = (name) => {
    if (!name) return 'Working';
    const n = name.toLowerCase();
    
    // Agent Tools
    if (n.includes('chromasearchtool')) return 'Searched knowledge base';
    if (n.includes('pageindexsearchtool')) return 'Navigated document tree';
    if (n.includes('latexgeneratortool')) return 'Generated LaTeX artifact';
    
    // Agent Sub-tasks
    if (n.startsWith('task:')) return name.replace('Task:', '').trim();
    
    // Legacy generic tools
    if (n.includes('vector search')) return 'Searched vectors';
    if (n.includes('crag')) return 'Extracted CRAG context';
    if (n.includes('synthesize')) return 'Synthesized context';
    if (n.includes('reranking')) return 'Reranked results';
    if (n.includes('context gathering complete')) return 'Gathered context';
    if (n.includes('extract')) return 'Extracted pages';
    
    return name; // fallback to showing the actual name instead of 'Used tool'
};

export const StepsSidebar = React.memo(function StepsSidebar({ steps }) {
  const [isExpanded, setIsExpanded] = useState(false);
  const isRunning = steps.some(s => s.status === 'running');

  if (!steps || steps.length === 0) return null;

  let headerText = 'Working...';
  if (isRunning) {
    const runningStep = steps.slice().reverse().find(s => s.status === 'running');
    if (runningStep) {
        headerText = getShortName(runningStep.name) + '...';
    }
  } else {
    // If finished, show the final completed step name
    const lastStep = steps[steps.length - 1];
    headerText = lastStep ? getShortName(lastStep.name) : 'Completed';
  }

  return (
    <div className="flex flex-col mb-5 w-full animate-[fadeIn_0.3s_ease]">
      <button 
        onClick={() => setIsExpanded(!isExpanded)}
        className="flex items-center gap-1.5 py-1 px-0 hover:text-[var(--text-primary)] transition-colors text-[var(--text-muted)] w-fit cursor-pointer border-none bg-transparent group"
      >
        <span className="text-[13.5px] font-medium transition-colors">{headerText}</span>
        {isExpanded ? <ChevronDown size={14} className="transition-colors opacity-70" /> : <ChevronRight size={14} className="transition-colors opacity-70" />}
      </button>

      {isExpanded && (
        <div className="flex flex-col relative mt-3 ml-0">
          {/* Vertical line connecting steps */}
          {steps.length > 1 && (
             <div className="absolute left-[7.5px] top-[14px] bottom-[20px] w-[1px] bg-[var(--border-mid)] z-0"></div>
          )}
          
          {steps.map((step, i) => (
            <div key={step.id || i} className="flex gap-4 relative z-10 py-2.5 group items-start">
              <div className={`mt-0.5 flex-shrink-0 w-[16px] h-[16px] flex items-center justify-center bg-[var(--bg-base)] ${
                  step.status === 'running' ? 'text-[var(--accent)]' : 'text-[var(--text-muted)]'
              }`}>
                {step.status === 'running' ? (
                  <Loader2 size={14} className="animate-spin" />
                ) : i === steps.length - 1 && !isRunning ? (
                  <CheckCircle2 size={14} />
                ) : (
                  <FileText size={14} />
                )}
              </div>
              <div className="flex flex-col justify-center flex-1 min-w-0">
                <span className={`text-[14px] leading-[1.4] transition-colors duration-300 ${
                  step.status === 'running' ? 'text-[var(--text-primary)]' : 'text-[var(--text-muted)]'
                }`}>
                  {step.name}
                </span>
                {step.inputJson && (
                   <div className={`mt-1.5 opacity-90 bg-[var(--bg-elevated)] border border-[var(--border-mid)] px-2.5 py-1.5 rounded-md w-full max-w-full overflow-hidden ${step.isThought ? 'text-[12.5px] text-[var(--text-primary)] italic' : 'text-[11.5px] text-[var(--text-muted)] font-mono'}`}>
                      <div className="whitespace-pre-wrap break-words max-w-full overflow-hidden">
                        {step.inputJson}
                      </div>
                   </div>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
});
