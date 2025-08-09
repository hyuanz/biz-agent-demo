// SSE helpers for JSON lines
export type OnError = (error: Error) => void;
export type OnDone = () => void;

// Parse text/event-stream from a ReadableStream (fetch) where each data line is JSON
export async function readJsonSSEFromFetch(
  response: Response,
  onJson: (obj: unknown) => void,
  onError: OnError,
  onDone: OnDone,
  signal?: AbortSignal
): Promise<void> {
  if (!response.ok || !response.body) {
    onError(new Error(`Bad response: ${response.status}`));
    onDone();
    return;
  }
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  try {
    while (true) {
      if (signal?.aborted) throw new Error('aborted');
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const parts = buffer.split(/\n\n/);
      buffer = parts.pop() ?? '';
      for (const part of parts) {
        const lines = part.split(/\n/);
        for (const line of lines) {
          if (line.startsWith('data:')) {
            let text = line.slice(5);
            if (text.startsWith(' ')) text = text.slice(1);
            try {
              const obj = JSON.parse(text);
              onJson(obj);
            } catch (e: any) {
              onError(new Error('Invalid JSON frame'));
            }
          }
        }
      }
    }
    if (buffer.length > 0) {
      const lines = buffer.split(/\n/);
      for (const line of lines) {
        if (line.startsWith('data:')) {
          let text = line.slice(5);
          if (text.startsWith(' ')) text = text.slice(1);
          try {
            const obj = JSON.parse(text);
            onJson(obj);
          } catch (e: any) {
            onError(new Error('Invalid JSON frame'));
          }
        }
      }
    }
    onDone();
  } catch (err: any) {
    onError(err instanceof Error ? err : new Error(String(err)));
    onDone();
  }
}



