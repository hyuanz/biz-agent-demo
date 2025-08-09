import { AgentEvent, SampleQuery } from '../types/types';
import { readJsonSSEFromFetch } from '../lib/sse';

const DEFAULT_BASE_URL = 'http://127.0.0.1:5001';

// CRA uses REACT_APP_ prefix. Avoid referencing import.meta in CRA builds.
const API_BASE_URL = process.env.REACT_APP_API_BASE_URL || DEFAULT_BASE_URL;

export async function fetchHealth(): Promise<{ ok: boolean; message?: string; gpt_enabled?: boolean }> {
  try {
    const res = await fetch(`${API_BASE_URL}/health`);
    if (!res.ok) return { ok: false, message: `HTTP ${res.status}` };
    const data = await res.json();
    return { ok: true, ...data };
  } catch (err: any) {
    return { ok: false, message: err?.message ?? 'Network error' };
  }
}

export async function fetchSampleQueries(): Promise<SampleQuery[]> {
  try {
    const res = await fetch(`${API_BASE_URL}/sample-queries`);
    if (!res.ok) return [];
    const data = await res.json();
    // Accept either [{ id, text }] or string[]
    if (Array.isArray(data)) {
      if (data.length > 0 && typeof data[0] === 'string') {
        return (data as string[]).map((text, idx) => ({ id: String(idx), text }));
      }
      return data as SampleQuery[];
    }
    return [];
  } catch {
    return [];
  }
}

// Deprecated endpoints (/chat, /chat-stream) intentionally removed. Use /agent-chat only.

export async function streamAgentChat(
  body: { session_id: string; messages: Array<{ role: string; content: string }> },
  handlers: {
    onEvent: (e: AgentEvent) => void;
    onError: (e: Error) => void;
    onDone: () => void;
  },
  controller?: AbortController
): Promise<void> {
  const res = await fetch(`${API_BASE_URL}/agent-chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal: controller?.signal,
  });
  await readJsonSSEFromFetch(
    res,
    (obj) => handlers.onEvent(obj as AgentEvent),
    handlers.onError,
    handlers.onDone,
    controller?.signal
  );
}

export async function fetchMemory(sessionId: string): Promise<unknown> {
  const u = new URL(`${API_BASE_URL}/memory`);
  u.searchParams.set('session_id', sessionId);
  const res = await fetch(u.toString());
  if (!res.ok) return null as any;
  return res.json();
}


