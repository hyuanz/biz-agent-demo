// Shared TypeScript types for the chat app

export type Role = 'user' | 'assistant';

export interface Message {
  id: string;
  role: Role;
  content: string;
}

export interface SampleQuery {
  id: string;
  text: string;
}

export interface HealthStatus {
  ok: boolean;
  message?: string;
  gpt_enabled?: boolean;
}

// Removed legacy text SSE types; JSON SSE only

// Agent streaming events (JSON lines)
export type AgentEvent =
  | { type: 'tool_call'; name: string; args: unknown }
  | { type: 'tool_result'; name: string; result: unknown }
  | { type: 'query_update'; query: string }
  | { type: 'final'; text: string };



