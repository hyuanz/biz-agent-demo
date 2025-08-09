import React, { useEffect, useRef } from 'react';
import { Message } from '../types/types';
import { MessageBubble } from './MessageBubble';

interface MessageListProps {
  messages: Message[];
  autoScroll?: boolean;
  thinkingForMessageId?: string | null;
  thinkingSteps?: string[];
}

export function MessageList({ messages, autoScroll = true, thinkingForMessageId, thinkingSteps = [] }: MessageListProps) {
  const endRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!autoScroll) return;
    endRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, autoScroll]);

  return (
    <div className="messages" aria-live="polite">
      {messages.map((m) => (
        <MessageBubble
          key={m.id}
          message={m}
          thinking={m.id === thinkingForMessageId && m.content.trim().length === 0 ? thinkingSteps : undefined}
        />
      ))}
      <div ref={endRef} />
    </div>
  );
}

export default MessageList;


