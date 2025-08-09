import React from 'react';
import { Message } from '../types/types';

interface MessageBubbleProps {
  message: Message;
  thinking?: string[];
}

export function MessageBubble({ message, thinking }: MessageBubbleProps) {
  const isUser = message.role === 'user';
  // Render assistant text with minimal markdown: headings and bold; disallow tables
  const content = message.content
    .replace(/^###\s+(.*)$/gm, (_, t) => t) // strip h3 markers
    .replace(/^\|.*\|$/gm, '') // strip table rows
    .replace(/^\|[-\s|]+\|$/gm, '') // strip table separators
    .replace(/\*\*(.*?)\*\*/g, (_, t) => t); // remove bold markers but keep text
  return (
    <div className="bubble-row" style={{ justifyContent: isUser ? 'flex-end' : 'flex-start', margin: '8px 0' }}>
      {!isUser && <div className="avatar">🤖</div>}
      <div className={`bubble ${isUser ? 'user' : 'assistant'}`} aria-label={isUser ? 'User message' : 'Assistant message'}>
        {content || (thinking && (
          <ul style={{ margin: 0, paddingLeft: 16, color: '#666' }}>
            {thinking.map((t, i) => (
              <li key={i}>{t}</li>
            ))}
          </ul>
        ))}
      </div>
      {isUser && <div className="avatar user">🙂</div>}
    </div>
  );
}

export default MessageBubble;


