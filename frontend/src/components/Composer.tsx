import React from 'react';
import { SampleQuery } from '../types/types';

interface ComposerProps {
  value: string;
  onChange: (v: string) => void;
  onSubmit: () => void;
  disabledInput?: boolean;
  disabledSubmit?: boolean;
  sampleQueries?: SampleQuery[];
  onCancel?: () => void;
  onNewChat?: () => void;
  cancelLabel?: string;
}

export function Composer({ value, onChange, onSubmit, disabledInput, disabledSubmit, sampleQueries = [], onCancel, onNewChat, cancelLabel = 'Cancel' }: ComposerProps) {
  const textareaRef = React.useRef<HTMLTextAreaElement | null>(null);

  const autoResize = React.useCallback(() => {
    const el = textareaRef.current;
    if (!el) return;
    const maxHeight = 160; // px
    el.style.height = 'auto';
    const next = Math.min(maxHeight, el.scrollHeight);
    el.style.height = `${next}px`;
    el.style.overflowY = el.scrollHeight > maxHeight ? 'auto' : 'hidden';
  }, []);

  React.useEffect(() => {
    autoResize();
  }, [value, autoResize]);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      if (!disabledSubmit) onSubmit();
    }
  };

  return (
    <div className="composer" style={{ borderTop: '1px solid var(--border)' }}>
      {/* sample prompts removed for quieter startup */}
      <div style={{ display: 'flex', gap: 8, alignItems: 'flex-start', width: '100%' }}>
        <textarea
          ref={textareaRef}
          placeholder="Ask about your analytics..."
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={handleKeyDown}
          rows={3}
          className="card"
          disabled={disabledInput}
          style={{ width: '100%' }}
        />
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6, flexShrink: 0 }}>
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            <button
              type="button"
              onClick={onSubmit}
              disabled={disabledSubmit || value.trim().length === 0}
              className={`btn ${disabledSubmit ? '' : 'btn-primary'}`}
            >
              Send
            </button>
            {/* run demo button removed from composer */}
            {onNewChat && (
              <button type="button" onClick={onNewChat} className="btn">New chat</button>
            )}
          </div>
        </div>
      </div>
      <div style={{ marginTop: 6, color: '#666', fontSize: 12 }}>Enter to send, Shift+Enter for newline</div>
    </div>
  );
}

export default Composer;


