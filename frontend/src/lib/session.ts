const STORAGE_KEY = 'chat_session_id';

function generateId(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}

export function getOrCreateSessionId(): string {
  const existing = localStorage.getItem(STORAGE_KEY);
  if (existing) return existing;
  const id = generateId();
  localStorage.setItem(STORAGE_KEY, id);
  return id;
}

export function createNewSessionId(): string {
  const id = generateId();
  localStorage.setItem(STORAGE_KEY, id);
  return id;
}

export function getSessionId(): string | null {
  return localStorage.getItem(STORAGE_KEY);
}





