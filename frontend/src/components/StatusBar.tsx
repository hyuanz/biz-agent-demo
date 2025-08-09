import React from 'react';

interface StatusBarProps {
  healthOk: boolean | null;
  loading: boolean;
  error?: string | null;
  note?: string | null;
}

export function StatusBar({ healthOk, loading, error, note }: StatusBarProps) {
  let text = '';
  if (loading) text = 'Streaming...';
  else if (error) text = `Error: ${error}`;
  else if (healthOk === true) text = 'Connected';
  else if (healthOk === false) text = 'Offline';
  else text = '—';

  const color = error ? '#b00020' : healthOk ? '#0f9d58' : '#999';

  return (
    <div
      role="status"
      aria-live="polite"
      style={{
        borderTop: '1px solid #eee',
        padding: '6px 12px',
        fontSize: 12,
        color,
        background: '#fcfcfc',
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
      }}
    >
      <span>{text}</span>
      {note ? <span style={{ color: '#555' }}>{note}</span> : <span />}
    </div>
  );
}

export default StatusBar;


